/**
 * lib/ai/gemini.ts
 * Gemini 1.5 Pro client with four-layer resilience policy (cockatiel v3):
 *
 *   BulkheadPolicy  (max 2 concurrent)
 *     → CircuitBreakerPolicy (open after 5 consecutive failures, half-open 30 s)
 *       → retry via handleAll().retry() (3 attempts, exponential backoff + jitter)
 *         → TimeoutPolicy  (25 s per call)
 *
 * All errors are re-thrown with structured context for upstream logging.
 */

import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
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

// ---------------------------------------------------------------------------
// Gemini client singleton
// ---------------------------------------------------------------------------
function getGenAI(): GoogleGenerativeAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("[Gemini] GEMINI_API_KEY is not set.");
    return new GoogleGenerativeAI(key);
}

// ---------------------------------------------------------------------------
// Resilience policies — cockatiel v3 (top-level exports)
// ---------------------------------------------------------------------------

/** Bulkhead: max 2 concurrent Gemini calls, queue up to 8 more */
const bulkheadPolicy = bulkhead(2, 8);

/** Timeout: 25 s aggressive timeout per call */
const timeoutPolicy = timeout(25_000, TimeoutStrategy.Aggressive);

/** Retry: 3 attempts with exponential backoff + jitter (1s → 2s → 4s) */
const retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({
        initialDelay: 1_000,
        maxDelay: 10_000,
    }),
});

/** Circuit Breaker: open after 5 consecutive failures; half-open after 30 s */
const circuitBreakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 30_000,
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
    explanation: z.string().optional(),
    /** AI signals a manual image crop is needed */
    imagePlaceholders: z.array(z.string()).optional(),
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

// ---------------------------------------------------------------------------
// System prompt (enforces JSON output + dual-column awareness)
// ---------------------------------------------------------------------------
const EXTRACTION_SYSTEM_PROMPT = `
You are a medical examination question extractor. Analyze the provided medical exam page images.

Output ONLY a valid JSON object matching this exact structure — no markdown fences, no prose:
{
  "questions": [
    {
      "stem": "Question text (Markdown supported)",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "A" | "B" | "C" | "D",
      "explanation": "Optional detailed explanation",
      "imagePlaceholders": ["[NEEDS_CROP_01]", ...]
    }
  ],
  "metadata": {
    "year": 2023,
    "examType": "國考",
    "pageCount": 1
  }
}

Critical rules:
1. Handle dual-column layouts correctly — read left column top-to-bottom, then right column.
2. If a question contains a figure or image that is required for answering, insert a placeholder
   string "[NEEDS_CROP_XX]" (where XX is a zero-padded index) in the stem. DO NOT describe
   or interpret image contents.
3. Preserve all medical terminology exactly as written.
4. If you cannot determine the answer with certainty, use "A" and set explanation to "UNCERTAIN".
`.trim();

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract structured questions from one or more page image URLs or base64 data.
 *
 * @param imageDataParts - Array of { type: "base64", mimeType, data } or { type: "url", url }
 * @param traceId        - Job trace ID for structured logging
 */
export async function extractQuestionsFromImages(
    imageDataParts: Array<
        | { type: "base64"; mimeType: string; data: string }
        | { type: "url"; url: string }
    >,
    traceId: string
): Promise<ExtractionResponse> {
    const genAI = getGenAI();

    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-pro",
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens: 8192,
        } satisfies GenerationConfig,
    });

    const parts = imageDataParts.map((part) => {
        if (part.type === "base64") {
            return { inlineData: { mimeType: part.mimeType, data: part.data } };
        } else {
            return { fileData: { mimeType: "image/png", fileUri: part.url } };
        }
    });

    // Execute through the four-layer resilience policy
    const rawText = await geminiPolicy.execute(async () => {
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
        });
        const text = result.response.text();
        if (!text) throw new Error("Gemini returned an empty response");
        return text;
    });

    // Parse and validate — Zod throws on invalid shape (Fail-Fast)
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        const structured = {
            level: "error",
            service: "gemini",
            traceId,
            message: "Gemini returned non-JSON output",
            rawOutput: rawText.slice(0, 500),
            timestamp: new Date().toISOString(),
        };
        console.error(JSON.stringify(structured));
        throw new Error(`Gemini JSON parse failure [traceId=${traceId}]`);
    }

    return ExtractionResponseSchema.parse(parsed);
}
