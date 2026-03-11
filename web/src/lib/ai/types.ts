/**
 * lib/ai/types.ts — Shared interfaces for all AI providers.
 *
 * Every provider (OpenAI-compatible, Anthropic, Gemini) must conform to these
 * types so that the router in `index.ts` can delegate transparently.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod Schemas (shared validation — identical to gemini.ts originals)
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

// ---------------------------------------------------------------------------
// Provider-agnostic metadata for audit logging
// ---------------------------------------------------------------------------

export interface LLMMeta {
    provider: "openai" | "anthropic" | "gemini";
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
// Image data parts accepted by extraction functions
// ---------------------------------------------------------------------------

export type ImageDataPart =
    | { type: "base64"; mimeType: string; data: string }
    | { type: "url"; url: string };

// ---------------------------------------------------------------------------
// Provider function signature
// ---------------------------------------------------------------------------

export type ExtractionFn = (
    imageDataParts: ImageDataPart[],
    traceId: string,
    onProgress?: (message: string) => void,
) => Promise<{ data: ExtractionResponse; meta: LLMMeta }>;

// ---------------------------------------------------------------------------
// Embedding task type (provider-agnostic replacement for Gemini TaskType)
// ---------------------------------------------------------------------------

export enum EmbedTaskType {
    /** Use when indexing documents for later retrieval */
    RETRIEVAL_DOCUMENT = "retrieval_document",
    /** Use when embedding a user's search query */
    RETRIEVAL_QUERY = "retrieval_query",
}
