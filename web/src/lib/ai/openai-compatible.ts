/**
 * lib/ai/openai-compatible.ts
 * OpenAI-compatible client for medical exam extraction.
 *
 * Default target: OpenAI API (gpt-5-mini) at https://api.openai.com/v1.
 * Also works with any OpenAI-compatible endpoint (vLLM, LM Studio, oMLX, etc.).
 *
 * Resilience stack (cockatiel v3) — mirrors gemini.ts:
 *   BulkheadPolicy  (max 2 concurrent)
 *     → CircuitBreakerPolicy (open after 5 consecutive failures, half-open 60 s)
 *       → RetryPolicy (2 attempts, exponential backoff + jitter)
 *         → TimeoutPolicy (600 s cooperative — large multi-image payloads)
 */

import { log } from "@/lib/logger";
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
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
    ExtractionResponseSchema,
    type ExtractionResponse,
    type ImageDataPart,
    type LLMMeta,
} from "./types";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export interface ServiceHealth {
    healthy: boolean;
    latencyMs: number;
    error?: string;
    models?: string[];
    configuredModel?: string;
}

export async function checkServiceHealth(): Promise<ServiceHealth> {
    const apiUrl = getApiUrl();
    const apiKey = getApiKey();
    const modelName = getVisionModel();
    const startTime = Date.now();

    try {
        const headers: Record<string, string> = {};
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${apiUrl}/models`, {
            method: "GET",
            headers,
        });

        const latencyMs = Date.now() - startTime;

        if (response.ok) {
            const json = (await response.json()) as { data?: Array<{ id: string }> };
            const models = json.data?.map((m) => m.id) ?? [];
            return {
                healthy: true,
                latencyMs,
                models,
                configuredModel: modelName,
            };
        }

        if (response.status === 401) {
            const body = await response.text();
            const isJson = body.startsWith("{");
            if (isJson) {
                try {
                    const json = JSON.parse(body);
                    const models = json.data?.map((m: { id: string }) => m.id) ?? [];
                    return {
                        healthy: true,
                        latencyMs,
                        models,
                        configuredModel: modelName,
                    };
                } catch {
                    // Not valid JSON, continue to error
                }
            }
            return {
                healthy: true,
                latencyMs,
                configuredModel: modelName,
            };
        }

        const errorBody = await response.text();
        return {
            healthy: false,
            latencyMs,
            error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            configuredModel: modelName,
        };
    } catch (err) {
        const latencyMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);
        return {
            healthy: false,
            latencyMs,
            error: message,
            configuredModel: modelName,
        };
    }
}

export interface WaitForServiceOptions {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    onAttempt?: (attempt: number, health: ServiceHealth) => void;
}

export async function waitForServiceHealth(
    options: WaitForServiceOptions = {},
): Promise<{ ready: boolean; attempts: number; finalHealth: ServiceHealth }> {
    const {
        maxWaitMs = 180_000,
        pollIntervalMs = 5_000,
        onAttempt,
    } = options;

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < maxWaitMs) {
        attempts++;
        const health = await checkServiceHealth();
        onAttempt?.(attempts, health);

        if (health.healthy) {
            return { ready: true, attempts, finalHealth: health };
        }

        const elapsed = Date.now() - startTime;
        const remaining = maxWaitMs - elapsed;

        if (remaining > pollIntervalMs) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        } else if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
        }
    }

    const finalHealth = await checkServiceHealth();
    return { ready: false, attempts, finalHealth };
}

function getApiUrl(): string {
    return process.env.OPENAI_API_URL ?? "https://api.openai.com/v1";
}

function getApiKey(): string {
    return process.env.OPENAI_API_KEY ?? "";
}

function getVisionModel(): string {
    return process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini";
}

// ---------------------------------------------------------------------------
// Structured logger helper
// ---------------------------------------------------------------------------
function oaiLog(
    level: "info" | "warn" | "error",
    traceId: string,
    message: string,
    extra?: Record<string, unknown>,
) {
    log[level]("openai-compat", message, { traceId, ...extra });
}

// ---------------------------------------------------------------------------
// Resilience policies — cockatiel v3 (mirrors gemini.ts)
// ---------------------------------------------------------------------------

const bulkheadPolicy = bulkhead(2, 8);

const timeoutPolicy = timeout(600_000, TimeoutStrategy.Cooperative);

const retryPolicy = retry(handleAll, {
    maxAttempts: 2,
    backoff: new ExponentialBackoff({
        initialDelay: 5_000,
        maxDelay: 30_000,
    }),
});

const circuitBreakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 60_000,
    breaker: new ConsecutiveBreaker(5),
});

const oaiPolicy = wrap(bulkheadPolicy, circuitBreakerPolicy, retryPolicy, timeoutPolicy);

// ---------------------------------------------------------------------------
// System prompt (same extraction rules as gemini.ts)
// ---------------------------------------------------------------------------
const EXTRACTION_SYSTEM_PROMPT_PREFIX = `
You are a medical examination question extractor. Analyze the provided medical exam page images and extract the questions.
所有輸出必須使用繁體中文。

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
   - Equilibrium constant: $K_{eq}$
   - Pyruvate formula: $CH_3COCOO^-$
   Do NOT use LaTeX for plain text like enzyme names or pathway names unless they contain
   special symbols, subscripts, or superscripts.
6. **No Fake Nulls**: If no explanation is provided or known, omit the explanation field entirely or use actual JSON null. Do NOT output strings like "UNDEFINED", "N/A", or "null".
7. **No Question Numbers**: DO NOT include the question number or prefix in the extracted 'stem'. Strip all leading numbers, dots, and whitespace from the question stem.
8. **Exhaustiveness**: You must extract EVERY single question present in the provided images. DO NOT stop early. DO NOT summarize. Read every page thoroughly until the end.
9. **Difficulty**: For each question, estimate its difficulty on a 1–5 integer scale:
   1 = trivial recall, 2 = straightforward, 3 = moderate reasoning, 4 = challenging multi-step, 5 = very hard / cross-discipline.
   Output this as the "difficulty" field.`.trim();

const EXTRACTION_JSON_SCHEMA_SUFFIX = `
You MUST output valid JSON matching this exact schema:
{
  "questions": [
    {
      "stem": "string (required)",
      "options": { "A": "string", "B": "string", "C": "string", "D": "string" },
      "answer": "A" | "B" | "C" | "D",
      "explanation": "string or null (optional)",
      "imagePlaceholders": ["string"] (optional),
      "difficulty": integer 1-5 (required),
      "tagSlugs": ["string"] (required, 1-5 slugs from the list above)
    }
  ],
  "metadata": {
    "year": number (optional),
    "examType": "string (optional)",
    "pageCount": number (required)
  }
}

Output ONLY the JSON object. No markdown fences, no extra text.`.trim();

import { getTagSlugPromptSection } from "./tag-prompt";

/** Build the full extraction system prompt with dynamic tag slugs from DB */
async function buildExtractionPrompt(): Promise<string> {
    const tagSection = await getTagSlugPromptSection();
    return `${EXTRACTION_SYSTEM_PROMPT_PREFIX}\n${tagSection}\n\n${EXTRACTION_JSON_SCHEMA_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Build OpenAI-format message content with vision
// ---------------------------------------------------------------------------

function buildUserContent(
    imageDataParts: ImageDataPart[],
): Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: `Extract ALL medical exam questions from the following ${imageDataParts.length} page image(s). Output ONLY the JSON object.`,
        },
    ];

    for (const part of imageDataParts) {
        if (part.type === "base64") {
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:${part.mimeType};base64,${part.data}`,
                },
            });
        } else {
            content.push({
                type: "image_url",
                image_url: { url: part.url },
            });
        }
    }

    return content;
}

// ---------------------------------------------------------------------------
// OpenAI chat completions response shape (subset we care about)
// ---------------------------------------------------------------------------

interface OAIChoice {
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string | null;
}

interface OAIUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

interface OAIChatResponse {
    id: string;
    choices: OAIChoice[];
    usage?: OAIUsage;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractQuestionsFromImages(
    imageDataParts: ImageDataPart[],
    traceId: string,
    onProgress?: (message: string) => void,
): Promise<{ data: ExtractionResponse; meta: LLMMeta }> {
    const modelName = getVisionModel();
    const apiUrl = getApiUrl();

    const totalImages = imageDataParts.length;
    const totalSizeBytes = imageDataParts.reduce((acc, part) => {
        if (part.type === "base64") return acc + Math.ceil(part.data.length * 0.75);
        return acc;
    }, 0);
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

    oaiLog("info", traceId, "Starting OpenAI-compatible extraction", {
        imageCount: totalImages,
        totalPayloadMB: totalSizeMB,
        model: modelName,
        apiUrl,
    });
    onProgress?.(`準備送出 ${totalImages} 張圖片 (${totalSizeMB} MB) 至 AI 模型`);

    const userContent = buildUserContent(imageDataParts);

    // Build dynamic extraction prompt (fetches tag slugs from DB, cached 10 min)
    const systemPrompt = await buildExtractionPrompt();

    // Reasoning models (o1/o3/o4/gpt-5*) require "developer" role instead of "system"
    const isReasoningModel = /^(o[134]|gpt-5)/.test(modelName);
    const systemRole = isReasoningModel ? "developer" : "system";

    let attemptCount = 0;
    let lastElapsedMs = 0;
    let lastFinishReason = "unknown";
    let lastPromptTokens = 0;
    let lastCandidateTokens = 0;
    let lastResponseLength = 0;

    const rawText = await oaiPolicy.execute(async () => {
        attemptCount++;
        oaiLog("info", traceId, `API call attempt ${attemptCount}`, { attempt: attemptCount });
        onProgress?.(`正在呼叫 AI (第 ${attemptCount} 次嘗試)...`);

        const startTime = Date.now();

        let response: Response;
        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            const apiKey = getApiKey();
            if (apiKey) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            // Note: gpt-5-mini is a reasoning model — it does NOT support
            // temperature, top_p, or other sampling parameters.
            // Only max_completion_tokens is allowed.
            response = await fetch(`${apiUrl}/chat/completions`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: systemRole, content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    max_completion_tokens: 65536,
                }),
            });
        } catch (fetchErr) {
            const err = fetchErr as Error;
            oaiLog("error", traceId, `Network error calling API`, {
                attempt: attemptCount,
                url: apiUrl,
                error: err.message,
                cause: err.cause,
            });
            throw new Error(
                `Failed to connect to ${apiUrl}: ${err.message}. Is the AI service reachable?`
            );
        }

        const elapsedMs = Date.now() - startTime;

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            oaiLog("error", traceId, `API returned HTTP ${response.status}`, {
                status: response.status,
                body: errorBody.slice(0, 500),
                attempt: attemptCount,
            });
            throw new Error(
                `OpenAI-compatible API returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`
            );
        }

        const json = (await response.json()) as OAIChatResponse;
        const text = json.choices?.[0]?.message?.content ?? "";

        oaiLog("info", traceId, "API response received", {
            attempt: attemptCount,
            elapsedMs,
            responseLength: text.length,
            finishReason: json.choices?.[0]?.finish_reason ?? "unknown",
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
        });

        if (!text || text.trim().length === 0) {
            const reason = json.choices?.[0]?.finish_reason ?? "NO_CONTENT";
            oaiLog("error", traceId, "API returned empty content", {
                finishReason: reason,
                attempt: attemptCount,
            });

            try {
                const logPath = join(tmpdir(), `hippocampus-oai-error-${traceId}.log`);
                await writeFile(logPath, JSON.stringify({ traceId, attempt: attemptCount, elapsedMs, json }, null, 2));
            } catch (e) {
                log.error("openai-compat", "Failed to write debug log", {
                    error: e instanceof Error ? e.message : String(e),
                });
            }

            throw new Error(
                `OpenAI-compatible API returned empty response (finishReason=${reason}, attempt=${attemptCount})`
            );
        }

        lastElapsedMs = elapsedMs;
        lastFinishReason = json.choices?.[0]?.finish_reason ?? "unknown";
        lastPromptTokens = json.usage?.prompt_tokens ?? 0;
        lastCandidateTokens = json.usage?.completion_tokens ?? 0;
        lastResponseLength = text.length;

        onProgress?.(`AI 回傳成功 (${elapsedMs}ms, ${text.length} chars)，正在驗證資料格式...`);
        return text;
    });

    oaiLog("info", traceId, "Extraction raw text received", {
        textLength: rawText.length,
        totalAttempts: attemptCount,
    });

    // ---------------------------------------------------------------------------
    // Strip markdown fences if the model wraps output in ```json ... ```
    // ---------------------------------------------------------------------------
    let cleanedText = rawText.trim();
    if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText
            .replace(/^```(?:json)?\s*\n?/, "")
            .replace(/\n?```\s*$/, "");
    }

    // ---------------------------------------------------------------------------
    // Parse JSON
    // ---------------------------------------------------------------------------
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleanedText);
    } catch {
        oaiLog("error", traceId, "Non-JSON output from API", {
            rawOutput: cleanedText.slice(0, 500),
        });
        throw new Error(`OpenAI-compatible JSON parse failure [traceId=${traceId}]`);
    }

    // ---------------------------------------------------------------------------
    // Auto-heal malformed shapes (same as gemini.ts)
    // ---------------------------------------------------------------------------
    try {
        if (Array.isArray(parsed)) {
            if (parsed.length > 0 && parsed[0].questions) {
                parsed = parsed[0];
            } else {
                parsed = {
                    questions: parsed,
                    metadata: {
                        year: new Date().getFullYear(),
                        examType: "自動修正",
                        pageCount: totalImages,
                    },
                };
            }
        }

        const validated = ExtractionResponseSchema.parse(parsed);
        oaiLog("info", traceId, "Extraction validated successfully", {
            questionCount: validated.questions.length,
            year: validated.metadata.year,
            examType: validated.metadata.examType,
        });
        onProgress?.(`成功萃取 ${validated.questions.length} 道題目`);

        const meta: LLMMeta = {
            provider: "openai",
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
        try {
            const dumpPath = join(tmpdir(), `oai-error-${traceId}.json`);
            await writeFile(dumpPath, cleanedText);
            oaiLog("error", traceId, `Dumped raw text to ${dumpPath}`);
        } catch (e) {
            log.error("openai-compat", "Failed to dump raw text", {
                error: e instanceof Error ? e.message : String(e),
            });
        }

        oaiLog("error", traceId, "Zod validation failed on API output", {
            zodError: String(zodErr),
            rawKeys: Object.keys(parsed as object),
        });
        throw zodErr;
    }
}

// ---------------------------------------------------------------------------
// PDF extraction via OpenAI Files API + GPT-5 Mini
// ---------------------------------------------------------------------------

interface OpenAIFileResponse {
    id: string;
    object: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
}

export async function uploadFileToOpenAI(
    filePath: string,
    traceId: string
): Promise<string> {
    const apiUrl = getApiUrl();
    const apiKey = getApiKey();
    const fileName = filePath.split("/").pop() ?? "document.pdf";

    const fileBuffer = await import("node:fs/promises").then((fs) => fs.readFile(filePath));
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), fileName);
    formData.append("purpose", "user_data");

    const headers: Record<string, string> = {};
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    oaiLog("info", traceId, "Uploading PDF to OpenAI Files API", {
        fileName,
        fileSize: fileBuffer.length,
    });

    const response = await fetch(`${apiUrl}/files`, {
        method: "POST",
        headers,
        body: formData,
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        oaiLog("error", traceId, `Files API upload failed: HTTP ${response.status}`, {
            status: response.status,
            body: errorBody.slice(0, 500),
        });
        throw new Error(`Failed to upload file to OpenAI: HTTP ${response.status}`);
    }

    const result = (await response.json()) as OpenAIFileResponse;
    oaiLog("info", traceId, "File uploaded successfully", {
        fileId: result.id,
        bytes: result.bytes,
    });

    return result.id;
}

export async function extractQuestionsFromPdf(
    pdfPath: string,
    traceId: string,
    onProgress?: (message: string) => void,
): Promise<{ data: ExtractionResponse; meta: LLMMeta }> {
    const modelName = getVisionModel();
    const apiUrl = getApiUrl();

    oaiLog("info", traceId, "Starting PDF extraction via Files API", {
        model: modelName,
        apiUrl,
        pdfPath,
    });
    onProgress?.(`正在上傳 PDF 至 AI 服務...`);

    let attemptCount = 0;
    let lastElapsedMs = 0;
    let lastFinishReason = "unknown";
    let lastPromptTokens = 0;
    let lastCandidateTokens = 0;
    let lastResponseLength = 0;
    let fileId: string | undefined;

    const rawText = await oaiPolicy.execute(async () => {
        attemptCount++;
        oaiLog("info", traceId, `PDF extraction attempt ${attemptCount}`, { attempt: attemptCount });
        onProgress?.(`正在處理 PDF (第 ${attemptCount} 次嘗試)...`);

        const startTime = Date.now();

        if (!fileId) {
            fileId = await uploadFileToOpenAI(pdfPath, traceId);
            onProgress?.(`PDF 上傳完成，正在萃取題目...`);
        }

        const systemPrompt = await buildExtractionPrompt();
        const isReasoningModel = /^(o[134]|gpt-5)/.test(modelName);
        const systemRole = isReasoningModel ? "developer" : "system";

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        const apiKey = getApiKey();
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: systemRole, content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            {
                                type: "file",
                                file: { file_id: fileId },
                            },
                            {
                                type: "text",
                                text: "Extract ALL medical exam questions from this PDF document. Output ONLY the JSON object.",
                            },
                        ],
                    },
                ],
                max_completion_tokens: 65536,
            }),
        });

        const elapsedMs = Date.now() - startTime;

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            oaiLog("error", traceId, `Chat API failed: HTTP ${response.status}`, {
                status: response.status,
                body: errorBody.slice(0, 500),
                attempt: attemptCount,
            });
            throw new Error(`OpenAI Chat API returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
        }

        const json = (await response.json()) as OAIChatResponse;
        const text = json.choices?.[0]?.message?.content ?? "";

        oaiLog("info", traceId, "PDF extraction response received", {
            attempt: attemptCount,
            elapsedMs,
            responseLength: text.length,
            finishReason: json.choices?.[0]?.finish_reason ?? "unknown",
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
        });

        if (!text || text.trim().length === 0) {
            const reason = json.choices?.[0]?.finish_reason ?? "NO_CONTENT";
            oaiLog("error", traceId, "Empty response from PDF extraction", {
                finishReason: reason,
                attempt: attemptCount,
            });
            throw new Error(`PDF extraction returned empty response (finishReason=${reason}, attempt=${attemptCount})`);
        }

        lastElapsedMs = elapsedMs;
        lastFinishReason = json.choices?.[0]?.finish_reason ?? "unknown";
        lastPromptTokens = json.usage?.prompt_tokens ?? 0;
        lastCandidateTokens = json.usage?.completion_tokens ?? 0;
        lastResponseLength = text.length;

        onProgress?.(`AI 回傳成功 (${elapsedMs}ms)，正在驗證資料格式...`);
        return text;
    });

    oaiLog("info", traceId, "PDF extraction raw text received", {
        textLength: rawText.length,
        totalAttempts: attemptCount,
    });

    let cleanedText = rawText.trim();
    if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText
            .replace(/^```(?:json)?\s*\n?/, "")
            .replace(/\n?```\s*$/, "");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleanedText);
    } catch {
        oaiLog("error", traceId, "Non-JSON output from PDF extraction", {
            rawOutput: cleanedText.slice(0, 500),
        });
        throw new Error(`PDF extraction JSON parse failure [traceId=${traceId}]`);
    }

    try {
        if (Array.isArray(parsed)) {
            if (parsed.length > 0 && parsed[0].questions) {
                parsed = parsed[0];
            } else {
                parsed = {
                    questions: parsed,
                    metadata: {
                        year: new Date().getFullYear(),
                        examType: "自動修正",
                        pageCount: 1,
                    },
                };
            }
        }

        const validated = ExtractionResponseSchema.parse(parsed);
        oaiLog("info", traceId, "PDF extraction validated successfully", {
            questionCount: validated.questions.length,
            year: validated.metadata.year,
            examType: validated.metadata.examType,
        });
        onProgress?.(`成功萃取 ${validated.questions.length} 道題目`);

        const meta: LLMMeta = {
            provider: "openai",
            model: modelName,
            imageCount: 0,
            totalPayloadMB: "0",
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
        try {
            const dumpPath = join(tmpdir(), `oai-pdf-error-${traceId}.json`);
            await writeFile(dumpPath, cleanedText);
            oaiLog("error", traceId, `Dumped raw text to ${dumpPath}`);
        } catch (e) {
            log.error("openai-compat", "Failed to dump raw text", {
                error: e instanceof Error ? e.message : String(e),
            });
        }

        oaiLog("error", traceId, "Zod validation failed on PDF extraction output", {
            zodError: String(zodErr),
            rawKeys: Object.keys(parsed as object),
        });
        throw zodErr;
    }
}
