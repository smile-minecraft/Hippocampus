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
export const maxDuration = 300; // 5 minutes — batch may be large

// ─── Request Schema ──────────────────────────────────────────────────────────

const QuestionInput = z.object({
    stem: z.string().min(1),
    options: z.object({
        A: z.string(),
        B: z.string(),
        C: z.string(),
        D: z.string(),
    }),
    answer: z.enum(["A", "B", "C", "D"]),
});

const RequestSchema = z.object({
    questions: z.array(QuestionInput).min(1).max(100),
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

// ─── Provider-agnostic chat completion ───────────────────────────────────────

async function chatCompletion(
    systemPrompt: string,
    userPrompt: string,
): Promise<string> {
    const provider = process.env.LLM_PROVIDER ?? "openai";

    if (provider === "gemini") {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
            ],
        });
        return result.response.text();
    }

    // Default: OpenAI-compatible
    const apiUrl = process.env.OPENAI_API_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    const model = process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini";

    const response = await fetch(`${apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`LLM API returned HTTP ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
        choices: Array<{ message: { content: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = RequestSchema.safeParse(body);

        if (!parsed.success) {
            return Res.fromZodError(parsed.error);
        }

        const { questions } = parsed.data;

        log.info("llm", "Generating explanations", {
            questionCount: questions.length,
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

        const raw = await chatCompletion(EXPLANATION_SYSTEM_PROMPT, userPrompt);

        // Parse the JSON array from LLM response
        // Strip markdown fences if present
        const cleaned = raw
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/, "")
            .trim();

        let explanations: string[];
        try {
            explanations = JSON.parse(cleaned);
        } catch {
            log.error("llm", "Failed to parse explanation JSON", {
                raw: raw.slice(0, 500),
            });
            return Res.internal("AI 回傳格式解析失敗，請重試");
        }

        if (!Array.isArray(explanations)) {
            return Res.internal("AI 回傳格式不正確");
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
        log.error("llm", "Generate explanations failed", { error: message });
        return Res.internal(`生成詳解失敗: ${message}`);
    }
}
