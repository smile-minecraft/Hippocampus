/**
 * lib/ai/gemini.ts
 * Gemini 2.5 Pro client for medical exam extraction.
 *
 * Resilience stack (cockatiel v3):
 *   BulkheadPolicy  (max 2 concurrent)
 *     → CircuitBreakerPolicy (open after 5 consecutive failures, half-open 30 s)
 *       → RetryPolicy (3 attempts, exponential backoff + jitter)
 *         → TimeoutPolicy (180 s per call — large PDFs take time)
 *
 * Every stage has structured logging so the operator can trace exactly
 * what is happening.
 */

import { GoogleGenerativeAI, SchemaType, type GenerationConfig, type Schema } from "@google/generative-ai";
import {
    bulkhead,
    circuitBreaker,
    ConsecutiveBreaker,
    ExponentialBackoff,
    handleAll,
    retry,
    timeout,
    TimeoutStrategy,
    wrap,
} from "cockatiel";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Gemini client singleton
// ---------------------------------------------------------------------------
function getGenAI(): GoogleGenerativeAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("[Gemini] GEMINI_API_KEY is not set.");
    return new GoogleGenerativeAI(key);
}

// ---------------------------------------------------------------------------
// Structured logger helper
// ---------------------------------------------------------------------------
function geminiLog(
    level: "info" | "warn" | "error",
    traceId: string,
    message: string,
    extra?: Record<string, unknown>
) {
    const entry = {
        level,
        service: "gemini",
        traceId,
        message,
        ...extra,
        timestamp: new Date().toISOString(),
    };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Resilience policies — cockatiel v3 (top-level exports)
// ---------------------------------------------------------------------------

/** Bulkhead: max 2 concurrent Gemini calls, queue up to 8 more */
const bulkheadPolicy = bulkhead(2, 8);

/**
 * Timeout: 600 s (10 min) per individual API call.
 *
 * WHY SO LONG? Gemini 2.5 Pro processing 6 high-res exam page images (11+ MB
 * base64 payload) consistently takes 200-220 seconds. The previous 180 s limit
 * caused the cockatiel timeout to fire BEFORE Gemini finished, discarding the
 * valid response and triggering a pointless retry cycle that burned 4× the API
 * quota.
 *
 * ⚠️  TimeoutStrategy.Cooperative is used instead of Aggressive so that the
 * underlying fetch is NOT aborted — if a response arrives at 201 s it is still
 * accepted rather than silently cancelled.
 */
const timeoutPolicy = timeout(600_000, TimeoutStrategy.Cooperative);

/**
 * Retry: 2 total attempts (1 original + 1 retry) with exponential backoff.
 * Kept low because each Gemini call costs significant tokens and takes ~3 min.
 */
const retryPolicy = retry(handleAll, {
    maxAttempts: 2,
    backoff: new ExponentialBackoff({
        initialDelay: 3_000,
        maxDelay: 15_000,
    }),
});

/** Circuit Breaker: open after 5 consecutive failures; half-open after 60 s */
const circuitBreakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 60_000,
    breaker: new ConsecutiveBreaker(5),
});

/**
 * Composed policy: bulkhead wraps circuitBreaker wraps retry wraps timeout.
 * Inner-most policy executes first.
 */
const geminiPolicy = wrap(bulkheadPolicy, circuitBreakerPolicy, retryPolicy, timeoutPolicy);

// ---------------------------------------------------------------------------
// Structured extraction schemas (Zod)
// ---------------------------------------------------------------------------

export const ExtractedQuestionSchema = z.object({
    stem: z.string().min(1),
    options: z.object({
        A: z.string(),
        B: z.string(),
        C: z.string(),
        D: z.string(),
    }),
    answer: z.enum(["A", "B", "C", "D"]),
    explanation: z.string().nullish(),
    /** AI signals a manual image crop is needed */
    imagePlaceholders: z.array(z.string()).nullish(),
});

export type ExtractedQuestion = z.infer<typeof ExtractedQuestionSchema>;

export const ExtractionResponseSchema = z.object({
    questions: z.array(ExtractedQuestionSchema),
    metadata: z.object({
        year: z.number().optional(),
        examType: z.string().optional(),
        pageCount: z.number(),
    }),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

/** Metadata captured from each Gemini API interaction — stored in DB for audit */
export interface GeminiMeta {
    model: string;
    imageCount: number;
    totalPayloadMB: string;
    totalAttempts: number;
    elapsedMs: number;
    responseLength: number;
    finishReason: string;
    promptTokenCount: number;
    candidatesTokenCount: number;
    questionCount: number;
    timestamp: string;
}

// ---------------------------------------------------------------------------
// System prompt (enforces JSON output + dual-column awareness)
// ---------------------------------------------------------------------------
const EXTRACTION_SYSTEM_PROMPT = `
You are a medical examination question extractor. Analyze the provided medical exam page images and extract the questions.

Critical rules:
1. Handle dual-column layouts correctly — read left column top-to-bottom, then right column.
2. If a question contains a figure or image that is required for answering, insert a placeholder
   string "[NEEDS_CROP_XX]" (where XX is a zero-padded index) in the stem. DO NOT describe
   or interpret image contents.
3. Preserve all medical terminology exactly as written.
4. If you cannot determine the answer with certainty, use "A" and set explanation to "UNCERTAIN".
5. **LaTeX formatting**: ALL chemical formulas, molecular formulas, biochemical reactions,
   subscripts, superscripts, Greek letters, and mathematical expressions MUST be wrapped
   in KaTeX inline syntax using single dollar signs: $...$. Examples:
   - Water: $H_2O$
   - ATP hydrolysis: $ATP \\rightarrow ADP + P_i$
   - Beta-oxidation: $\\beta$-oxidation
   - Acetyl-CoA: $\\text{acetyl-CoA}$ (simple names do NOT need LaTeX)
   - Equilibrium constant: $K_{eq}$
   - Pyruvate formula: $CH_3COCOO^-$
   Do NOT use LaTeX for plain text like enzyme names or pathway names unless they contain
   special symbols, subscripts, or superscripts.
6. **No Fake Nulls**: If no explanation is provided or known, omit the explanation field entirely or use actual JSON null. Do NOT output strings like "UNDEFINED", "N/A", or "null".
7. **No Question Numbers**: DO NOT include the question number or prefix in the extracted 'stem'. For example, if the text says "1. During early embryonic development", extract ONLY "During early embryonic development". Strip all leading numbers, dots, and whitespace from the question stem.
8. **Exhaustiveness**: You must extract EVERY single question present in the provided images. DO NOT stop early. DO NOT summarize. Read every page thoroughly until the end.
`.trim();

// ---------------------------------------------------------------------------
// Native Structured Output Schema Definition
// ---------------------------------------------------------------------------
const extractionResponseApiSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        questions: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    stem: { type: SchemaType.STRING },
                    options: {
                        type: SchemaType.OBJECT,
                        properties: {
                            A: { type: SchemaType.STRING },
                            B: { type: SchemaType.STRING },
                            C: { type: SchemaType.STRING },
                            D: { type: SchemaType.STRING },
                        },
                        required: ["A", "B", "C", "D"],
                    },
                    answer: { type: SchemaType.STRING },
                    explanation: { type: SchemaType.STRING },
                    imagePlaceholders: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                    },
                },
                required: ["stem", "options", "answer"],
            },
        },
        metadata: {
            type: SchemaType.OBJECT,
            properties: {
                year: { type: SchemaType.INTEGER },
                examType: { type: SchemaType.STRING },
                pageCount: { type: SchemaType.INTEGER },
            },
            required: ["pageCount"],
        },
    },
    required: ["questions", "metadata"],
};

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract structured questions from one or more page image URLs or base64 data.
 *
 * @param imageDataParts - Array of { type: "base64", mimeType, data } or { type: "url", url }
 * @param traceId        - Job trace ID for structured logging
 * @param onProgress     - Optional callback for progress updates (0-100 within this step)
 */
export async function extractQuestionsFromImages(
    imageDataParts: Array<
        | { type: "base64"; mimeType: string; data: string }
        | { type: "url"; url: string }
    >,
    traceId: string,
    onProgress?: (message: string) => void,
): Promise<{ data: ExtractionResponse; meta: GeminiMeta }> {
    const genAI = getGenAI();
    const modelName = "gemini-2.5-pro";

    // Log the start of extraction with image count and sizes
    const totalImages = imageDataParts.length;
    const totalSizeBytes = imageDataParts.reduce((acc, part) => {
        if (part.type === "base64") return acc + Math.ceil(part.data.length * 0.75);
        return acc;
    }, 0);
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

    geminiLog("info", traceId, `Starting Gemini extraction`, {
        imageCount: totalImages,
        totalPayloadMB: totalSizeMB,
        model: modelName,
    });
    onProgress?.(`準備送出 ${totalImages} 張圖片 (${totalSizeMB} MB) 至 AI 模型`);

    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: extractionResponseApiSchema,
            temperature: 0.1,
            maxOutputTokens: 65536,
        } satisfies GenerationConfig,
    });

    const parts = imageDataParts.map((part) => {
        if (part.type === "base64") {
            return { inlineData: { mimeType: part.mimeType, data: part.data } };
        } else {
            return { fileData: { mimeType: "image/png", fileUri: part.url } };
        }
    });

    let attemptCount = 0;
    let lastElapsedMs = 0;
    let lastFinishReason = "unknown";
    let lastPromptTokens = 0;
    let lastCandidateTokens = 0;
    let lastResponseLength = 0;

    // Execute through the four-layer resilience policy
    const rawText = await geminiPolicy.execute(async () => {
        attemptCount++;
        geminiLog("info", traceId, `Gemini API call attempt ${attemptCount}`, { attempt: attemptCount });
        onProgress?.(`正在呼叫 Gemini AI (第 ${attemptCount} 次嘗試)...`);

        const startTime = Date.now();
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
        });

        const elapsedMs = Date.now() - startTime;
        const response = result.response;
        const text = response.text();

        // Log detailed response info
        geminiLog("info", traceId, `Gemini API response received`, {
            attempt: attemptCount,
            elapsedMs,
            responseLength: text?.length ?? 0,
            finishReason: response.candidates?.[0]?.finishReason ?? "unknown",
            promptTokenCount: response.usageMetadata?.promptTokenCount ?? 0,
            candidatesTokenCount: response.usageMetadata?.candidatesTokenCount ?? 0,
        });

        if (!text || text.trim().length === 0) {
            const reason = response.candidates?.[0]?.finishReason ?? "NO_CANDIDATES";
            const safetyRatings = response.candidates?.[0]?.safetyRatings;
            geminiLog("error", traceId, `Gemini returned empty response`, {
                finishReason: reason,
                safetyRatings,
                attempt: attemptCount,
            });

            // Write debug log to disk
            try {
                const logPath = join(tmpdir(), `hippocampus-gemini-error-${traceId}.log`);
                await writeFile(logPath, JSON.stringify({
                    traceId,
                    attempt: attemptCount,
                    elapsedMs,
                    finishReason: reason,
                    safetyRatings,
                    promptSize: parts.length
                }, null, 2));
            } catch (e) {
                console.error("Failed to write debug log", e);
            }

            throw new Error(
                `Gemini returned an empty response (finishReason=${reason}, attempt=${attemptCount})`
            );
        }

        lastElapsedMs = elapsedMs;
        lastFinishReason = response.candidates?.[0]?.finishReason ?? "unknown";
        lastPromptTokens = response.usageMetadata?.promptTokenCount ?? 0;
        lastCandidateTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        lastResponseLength = text.length;

        onProgress?.(`AI 回傳成功 (${elapsedMs}ms, ${text.length} chars)，正在驗證資料格式...`);
        return text;
    });

    geminiLog("info", traceId, `Gemini extraction raw text received`, {
        textLength: rawText.length,
        totalAttempts: attemptCount,
    });

    // Parse and validate — Zod throws on invalid shape (Fail-Fast)
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        geminiLog("error", traceId, "Gemini returned non-JSON output", {
            rawOutput: rawText.slice(0, 500),
        });
        throw new Error(`Gemini JSON parse failure [traceId=${traceId}]`);
    }

    // Validate with Zod
    try {
        // If Gemini returned a raw array, wrap it in the expected object structure
        if (Array.isArray(parsed)) {
            if (parsed.length > 0 && parsed[0].questions) {
                // Gemini wrapped the entire correct object inside an array: `[{ questions: [] }]`
                parsed = parsed[0];
            } else {
                // Gemini returned a raw array of questions
                parsed = {
                    questions: parsed,
                    metadata: {
                        year: new Date().getFullYear(),
                        examType: "自動修正", // Fallback
                        pageCount: totalImages,
                    }
                };
            }
        }

        const validated = ExtractionResponseSchema.parse(parsed);
        geminiLog("info", traceId, `Extraction validated successfully`, {
            questionCount: validated.questions.length,
            year: validated.metadata.year,
            examType: validated.metadata.examType,
        });
        onProgress?.(`成功萃取 ${validated.questions.length} 道題目`);

        const meta: GeminiMeta = {
            model: modelName,
            imageCount: totalImages,
            totalPayloadMB: totalSizeMB,
            totalAttempts: attemptCount,
            elapsedMs: lastElapsedMs,
            responseLength: lastResponseLength,
            finishReason: lastFinishReason,
            promptTokenCount: lastPromptTokens,
            candidatesTokenCount: lastCandidateTokens,
            questionCount: validated.questions.length,
            timestamp: new Date().toISOString(),
        };

        return { data: validated, meta };
    } catch (zodErr) {
        // Dump the raw text to a file so we can debug Gemini's output
        try {
            const fs = require('node:fs');
            const path = require('node:path');
            const os = require('node:os');
            const dumpPath = path.join(os.tmpdir(), `gemini-error-${traceId}.json`);
            fs.writeFileSync(dumpPath, rawText);
            geminiLog("error", traceId, `Dumped raw text to ${dumpPath}`);
        } catch (e) {
            console.error("Failed to dump raw text", e);
        }

        geminiLog("error", traceId, "Zod validation failed on Gemini output", {
            zodError: String(zodErr),
            rawKeys: Object.keys(parsed as object),
        });
        throw zodErr;
    }
}
