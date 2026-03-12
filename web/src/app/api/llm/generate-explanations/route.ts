/**
 * POST /api/llm/generate-explanations
 *
 * Accepts an array of questions (stem, options, answer) and returns
 * AI-generated explanations in 繁體中文 for each.
 *
 * Request body:
 * {
 *   questions: Array<{
 *     stem: string;
 *     options: { A: string; B: string; C: string; D: string };
 *     answer: "A" | "B" | "C" | "D";
 *   }>;
 * }
 *
 * Response:
 * { ok: true, data: { explanations: string[] } }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Res } from "@/lib/api-response";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 minutes — give LLM plenty of time for reasoning models

// ─── Request Schema ──────────────────────────────────────────────────────────

const QuestionInput = z.object({
    stem: z.string().min(1),
    options: z.record(z.string(), z.string()), // Accept any keys (A, B, C, D, etc.)
    answer: z.string().min(1), // Accept any non-empty string answer
});

const RequestSchema = z.object({
    questions: z.array(QuestionInput).min(1).max(20), // Frontend splits into batches of 10; allow small headroom
});

// ─── Explanation System Prompt ───────────────────────────────────────────────

const EXPLANATION_SYSTEM_PROMPT = `你是一位經驗豐富的醫學教育專家。你的任務是為醫學考試題目撰寫詳細解析。

規則：
1. 所有輸出必須使用繁體中文。
2. 解析應涵蓋：為什麼正確答案是正確的、為什麼其他選項是錯誤的。
3. 加入相關的醫學知識背景說明，幫助學生理解核心概念。
4. 使用 KaTeX 行內語法 $...$ 處理化學式、分子式、上下標和希臘字母。
5. 回答格式為 JSON 陣列，每個元素是一個字串（對應一題的解析）。
6. 輸出範例：["第一題的解析...", "第二題的解析..."]
7. 只輸出 JSON 陣列，不要加 markdown 圍欄或其他文字。`;

// ─── Gemini singleton (reuse across requests) ───────────────────────────────

let _geminiClient: import("@google/generative-ai").GoogleGenerativeAI | null = null;

function getGeminiClient(): import("@google/generative-ai").GoogleGenerativeAI {
    if (_geminiClient) return _geminiClient;
    // Dynamic require is avoided — caller must await importGeminiClient()
    throw new Error("Gemini client not initialized. Call importGeminiClient() first.");
}

async function importGeminiClient(): Promise<import("@google/generative-ai").GoogleGenerativeAI> {
    if (_geminiClient) return _geminiClient;
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    _geminiClient = new GoogleGenerativeAI(apiKey);
    return _geminiClient;
}

// ─── Provider-agnostic chat completion ───────────────────────────────────────

/**
 * Compute a per-request timeout based on question count.
 * Single question: 60s, scales linearly, capped at 240s (leave 60s buffer from maxDuration=300).
 */
function computeTimeoutMs(questionCount: number): number {
    const base = 60_000;
    const perQuestion = 3_000; // ~3s per question
    return Math.min(base + perQuestion * questionCount, 240_000);
}

async function chatCompletion(
    systemPrompt: string,
    userPrompt: string,
    questionCount: number,
): Promise<string> {
    const provider = process.env.LLM_PROVIDER ?? "openai";
    const timeoutMs = computeTimeoutMs(questionCount);

    if (provider === "gemini") {
        const genAI = await importGeminiClient();
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        });

        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);

        try {
            const result = await model.generateContent({
                contents: [
                    { role: "user", parts: [{ text: userPrompt }] },
                ],
            });
            return result.response.text();
        } finally {
            clearTimeout(timer);
        }
    }

    // Default: OpenAI-compatible
    const apiUrl = process.env.OPENAI_API_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";

    // Detect reasoning models that don't support temperature/top_p
    const isReasoningModel = /^(o[134]|gpt-5)/.test(model);

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            signal: abortController.signal,
            body: JSON.stringify({
                model,
                messages: [
                    // Reasoning models (o-series, gpt-5*) require "developer" role
                    // instead of "system" in the Chat Completions API.
                    { role: isReasoningModel ? "developer" : "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                // Reasoning models reject temperature/top_p
                ...(isReasoningModel
                    ? { max_completion_tokens: 65536 }
                    : { temperature: 0.3 }),
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`LLM API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
        }

        const json = (await response.json()) as {
            choices: Array<{ message: { content: string | null } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new Error("LLM returned empty content");
        return content;
    } finally {
        clearTimeout(timer);
    }
}

// ─── Robust JSON extraction from LLM response ──────────────────────────────

/**
 * Strip markdown fences and extract the JSON array from the LLM response.
 * Handles leading/trailing whitespace, markdown fences, and nested fences.
 */
function extractJsonArray(raw: string): string[] {
    // Step 1: Trim whitespace first (fixes ^``` anchor mismatch)
    let cleaned = raw.trim();

    // Step 2: Strip markdown fences (```json ... ``` or ``` ... ```)
    // Use non-greedy matching with [^] instead of [\s\S]* to avoid over-stripping
    cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/```\s*$/, "")
        .trim();

    // Step 3: If the cleaned text doesn't start with '[', try to find the array
    if (!cleaned.startsWith("[")) {
        // Try to find JSON array in the response
        const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
        if (arrayMatch) {
            cleaned = arrayMatch[0];
        }
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) {
            throw new Error("Expected JSON array but got " + typeof parsed);
        }
        return parsed;
    } catch (parseErr) {
        // Last resort: try to extract individual explanation strings
        // by looking for patterns like "第X題解析：" or numbered explanations
        log.error("llm", "JSON parse failed, attempting fallback extraction", {
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            cleanedPreview: cleaned.slice(0, 200),
        });

        // Try to find any quoted strings that look like explanations
        const fallbackMatches = cleaned.match(/"([^"]+)"/g);
        if (fallbackMatches) {
            return fallbackMatches.map(m => m.slice(1, -1)); // Remove quotes
        }

        throw parseErr; // Re-throw original error if fallback fails
    }
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = RequestSchema.safeParse(body);

        if (!parsed.success) {
            const zodIssues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
            log.error('llm', 'Zod validation failed', { issues: zodIssues, bodyKeys: Object.keys(body) })
            return Res.fromZodError(parsed.error);
        }

        const { questions } = parsed.data;

        log.info("llm", "Generating explanations", {
            questionCount: questions.length,
            provider: process.env.LLM_PROVIDER ?? "openai",
            model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
        });

        // Build user prompt with all questions
        const userPrompt = questions
            .map((q, i) => {
                const opts = Object.entries(q.options)
                    .map(([k, v]) => `  (${k}) ${v}`)
                    .join("\n");
                return `【第${i + 1}題】\n題幹：${q.stem}\n選項：\n${opts}\n正確答案：${q.answer}`;
            })
            .join("\n\n");

        const raw = await chatCompletion(EXPLANATION_SYSTEM_PROMPT, userPrompt, questions.length);

        // Parse the JSON array from LLM response
        let explanations: string[];
        try {
            explanations = extractJsonArray(raw);
        } catch {
            log.error("llm", "Failed to parse explanation JSON", {
                raw: raw.slice(0, 500),
            });
            return Res.internal("AI 回傳格式解析失敗，請重試");
        }

        // Pad or truncate to match input length
        while (explanations.length < questions.length) {
            explanations.push("");
        }
        explanations = explanations.slice(0, questions.length);

        log.info("llm", "Explanations generated successfully", {
            questionCount: questions.length,
            explanationCount: explanations.length,
        });

        return Res.ok({ explanations });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown error";

        // Provide friendlier message for timeouts
        const isTimeout = message.includes("abort") || message.includes("timeout");
        const userMessage = isTimeout
            ? "AI 回應超時，請減少題數後重試"
            : `生成詳解失敗: ${message}`;

        log.error("llm", "Generate explanations failed", { error: message });
        return Res.internal(userMessage);
    }
}
