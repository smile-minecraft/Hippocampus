/**
 * embedding.ts — Multi-Provider Embedding Service + Semantic Chunking
 *
 * Responsibilities:
 *  1. `embed(text)` — converts a string to a float32[1536] vector via the
 *     configured embedding provider (default: OpenAI text-embedding-3-small).
 *  2. `semanticChunk(markdown)` — splits long content into index-able chunks
 *     without severing semantic meaning mid-sentence.
 *  3. `cosineSimilarity(a, b)` — retained ONLY for unit-test comparison purposes.
 *     All production similarity queries use pgvector's `<=>` operator in SQL.
 *
 * Design Notes:
 *  - HNSW index on `embedding vector(1536)` columns (WikiArticle + Question).
 *  - Primary model: OpenAI text-embedding-3-small (1536 dimensions natively).
 *  - Embedding generation is intentionally lazy: it runs as a background task
 *    after a question is created, not in the same HTTP request cycle.
 *  - When LLM_PROVIDER=gemini, falls back to Gemini text-embedding-004;
 *    output is padded/truncated to match EMBEDDING_DIMENSIONS (1536).
 *
 * Edge-Case Coverage:
 *  - API failure: propagates as Error for caller to handle (cockatiel at call site).
 *  - Empty input: guard clause rejects blank strings before API call.
 *  - Oversized content: semantic chunking prevents exceeding model token limit.
 *  - OOM: chunks are processed sequentially, not concurrently, to bound memory.
 */

import { log } from "@/lib/logger";
import { EmbedTaskType } from "@/lib/ai/types";

// Re-export EmbedTaskType so existing callers can import from here
export { EmbedTaskType };

// ─── Config ───────────────────────────────────────────────────────────────────

function getProvider(): "openai" | "gemini" {
    const raw = process.env.LLM_PROVIDER ?? "openai";
    if (raw === "gemini") return "gemini";
    return "openai";
}

function getApiUrl(): string {
    return process.env.OPENAI_API_URL ?? "https://api.openai.com/v1";
}

function getApiKey(): string {
    return process.env.OPENAI_API_KEY ?? "";
}

function getEmbeddingModel(): string {
    return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
}

export const EMBEDDING_DIMENSIONS = 1536;

// ─── Semantic Chunking ────────────────────────────────────────────────────────

const MIN_CHUNK_TOKENS = 128;  // merge below this threshold
const MAX_CHUNK_TOKENS = 512;  // split above this threshold

/**
 * Rough token estimator (≈ 1 token per 4 characters for CJK/Latin mix).
 * Good enough for chunking; exact count is not required.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Strips common Markdown syntax from a string, keeping content text.
 */
function stripMarkdown(md: string): string {
    return md
        .replace(/^#{1,6}\s+/gm, "")     // headings
        .replace(/\*\*(.+?)\*\*/g, "$1") // bold
        .replace(/\*(.+?)\*/g, "$1")     // italic
        .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline code & code blocks
        .replace(/!\[.*?\]\(.*?\)/g, "")  // images
        .replace(/\[(.+?)\]\(.*?\)/g, "$1") // links → text only
        .replace(/^\s*[-*+>]\s+/gm, "")  // list markers & blockquotes
        .trim();
}

export interface TextChunk {
    index: number;
    text: string;
}

/**
 * Splits Markdown content into semantically coherent chunks.
 *
 * Algorithm:
 *  1. Strip Markdown syntax.
 *  2. Split on double newlines (paragraph boundaries).
 *  3. Merge undersized paragraphs with their successor.
 *  4. Split oversized paragraphs on sentence terminators.
 */
export function semanticChunk(markdown: string): TextChunk[] {
    const plain = stripMarkdown(markdown);
    const rawParagraphs = plain
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => p.length > 0);

    // Merge short paragraphs
    const merged: string[] = [];
    let accumulator = "";
    for (const para of rawParagraphs) {
        const candidate = accumulator ? `${accumulator} ${para}` : para;
        if (estimateTokens(candidate) < MIN_CHUNK_TOKENS) {
            accumulator = candidate;
        } else {
            if (accumulator) merged.push(accumulator);
            accumulator = para;
        }
    }
    if (accumulator) merged.push(accumulator);

    // Split oversized chunks at sentence boundaries
    const finalChunks: string[] = [];
    for (const chunk of merged) {
        if (estimateTokens(chunk) <= MAX_CHUNK_TOKENS) {
            finalChunks.push(chunk);
            continue;
        }
        // Split on Chinese/English sentence terminators
        const sentences = chunk.split(/(?<=[。！？.!?])\s*/);
        let current = "";
        for (const sentence of sentences) {
            const candidate = current ? `${current}${sentence}` : sentence;
            if (estimateTokens(candidate) > MAX_CHUNK_TOKENS && current) {
                finalChunks.push(current.trim());
                current = sentence;
            } else {
                current = candidate;
            }
        }
        if (current.trim()) finalChunks.push(current.trim());
    }

    return finalChunks
        .filter((t) => t.length > 0)
        .map((text, index) => ({ index, text }));
}

// ─── OpenAI-compatible Embedding ─────────────────────────────────────────────

interface OAIEmbeddingResponse {
    data: Array<{ embedding: number[]; index: number }>;
    usage?: { prompt_tokens: number; total_tokens: number };
}

/**
 * Calls an OpenAI-compatible /v1/embeddings endpoint.
 */
async function embedViaOpenAI(text: string): Promise<number[]> {
    const apiUrl = getApiUrl();
    const model = getEmbeddingModel();

    let response: Response;
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        const apiKey = getApiKey();
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        response = await fetch(`${apiUrl}/embeddings`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model,
                input: text,
            }),
        });
    } catch (fetchErr) {
        const err = fetchErr as Error;
        log.error("embedding", `Failed to connect to ${apiUrl}`, {
            error: err.message,
            cause: err.cause,
        });
        throw new Error(
            `[Embedding] Failed to connect to ${apiUrl}: ${err.message}. Is the AI service reachable?`
        );
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
            `[Embedding] OpenAI-compatible API returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`
        );
    }

    const json = (await response.json()) as OAIEmbeddingResponse;
    const values = json.data?.[0]?.embedding;

    if (!values || values.length === 0) {
        throw new Error("[Embedding] API returned empty embedding vector.");
    }

    // Truncate or pad to EMBEDDING_DIMENSIONS
    if (values.length < EMBEDDING_DIMENSIONS) {
        return [...values, ...new Array(EMBEDDING_DIMENSIONS - values.length).fill(0)];
    }
    return values.slice(0, EMBEDDING_DIMENSIONS);
}

// ─── Gemini Embedding (fallback) ─────────────────────────────────────────────

/**
 * Falls back to Gemini text-embedding-004 when LLM_PROVIDER=gemini.
 * Lazy-imports @google/generative-ai to avoid requiring it when not in use.
 */
async function embedViaGemini(text: string, taskType: EmbedTaskType): Promise<number[]> {
    const { GoogleGenerativeAI, TaskType } = await import("@google/generative-ai");

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("[Embedding] GEMINI_API_KEY is not set.");

    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: "text-embedding-004" });

    const geminiTaskType = taskType === EmbedTaskType.RETRIEVAL_QUERY
        ? TaskType.RETRIEVAL_QUERY
        : TaskType.RETRIEVAL_DOCUMENT;

    const result = await model.embedContent({
        content: { role: "user", parts: [{ text }] },
        taskType: geminiTaskType,
    });

    const values = result.embedding.values;

    // Pad or truncate to EMBEDDING_DIMENSIONS (1536)
    if (values.length < EMBEDDING_DIMENSIONS) {
        return [...values, ...new Array(EMBEDDING_DIMENSIONS - values.length).fill(0)];
    }
    return values.slice(0, EMBEDDING_DIMENSIONS);
}

// ─── Embed Single Text ────────────────────────────────────────────────────────

/**
 * Converts a text string to a 1536-dimensional embedding vector.
 *
 * @param text     The text to embed. Max ~8192 tokens.
 * @param taskType Use RETRIEVAL_DOCUMENT when indexing,
 *                 RETRIEVAL_QUERY when embedding a user search query.
 */
export async function embed(
    text: string,
    taskType: EmbedTaskType = EmbedTaskType.RETRIEVAL_DOCUMENT,
): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error("[Embedding] Cannot embed an empty string.");
    }

    const provider = getProvider();

    if (provider === "gemini") {
        return embedViaGemini(trimmed, taskType);
    }

    // Default: OpenAI-compatible (text-embedding-3-small)
    return embedViaOpenAI(trimmed);
}

// ─── Batch Embed ──────────────────────────────────────────────────────────────

/**
 * Embeds an array of text chunks sequentially to avoid API rate limits.
 * Returns an array of vectors in the same order as input.
 */
export async function embedChunks(
    chunks: TextChunk[],
): Promise<{ index: number; vector: number[] }[]> {
    const results: { index: number; vector: number[] }[] = [];

    for (const chunk of chunks) {
        const vector = await embed(chunk.text, EmbedTaskType.RETRIEVAL_DOCUMENT);
        results.push({ index: chunk.index, vector });
        // Polite delay between API calls to stay within rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    log.info("embedding", `Embedded ${results.length} chunks`, {
        dimensions: EMBEDDING_DIMENSIONS,
        provider: getProvider(),
    });

    return results;
}

// ─── Cosine Similarity (Unit Tests Only) ─────────────────────────────────────
// ⚠️  DO NOT use this in production search paths.
//     All similarity queries MUST use pgvector's `<=>` operator via SQL.

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error("Vectors must have the same dimensionality.");
    }
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}
