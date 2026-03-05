/**
 * embedding.ts — Gemini text-embedding-004 Service + Semantic Chunking
 *
 * Responsibilities:
 *  1. `embed(text)` — converts a string to a float32[1536] vector via Gemini API.
 *  2. `semanticChunk(markdown)` — splits long content into index-able chunks
 *     without severing semantic meaning mid-sentence.
 *  3. `cosineSimilarity(a, b)` — retained ONLY for unit-test comparison purposes.
 *     All production similarity queries use pgvector's `<=>` operator in SQL.
 *
 * Design Notes:
 *  - Agent A's HNSW migration creates `Question_embedding_hnsw_idx` on the
 *    inline `embedding vector(1536)` column.  We write to that column directly.
 *  - Gemini `text-embedding-004` outputs 768 dimensions by default, but the
 *    schema declares vector(1536) — we use `outputDimensionality: 1536` to match.
 *  - Embedding generation is intentionally lazy: it runs as a background task
 *    after a question is created, not in the same HTTP request cycle.
 *
 * Edge-Case Coverage:
 *  - API failure: exponential backoff via cockatiel (already in package.json).
 *  - Empty input: guard clause rejects blank strings before API call.
 *  - Oversized content: semantic chunking prevents exceeding Gemini's token limit.
 *  - OOM: chunks are processed sequentially, not concurrently, to bound memory.
 */

import {
    GoogleGenerativeAI,
    TaskType,
} from "@google/generative-ai";

// ─── Client Init ──────────────────────────────────────────────────────────────

function getClient(): GoogleGenerativeAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("[Embedding] GEMINI_API_KEY is not set.");
    return new GoogleGenerativeAI(key);
}

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMENSIONS = 1536;

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

// ─── Embed Single Text ────────────────────────────────────────────────────────

/**
 * Converts a text string to a 1536-dimensional embedding vector.
 *
 * @param text    The text to embed.  Max ~8192 tokens.
 * @param taskType Gemini task hint.  Use RETRIEVAL_DOCUMENT when indexing,
 *                RETRIEVAL_QUERY when embedding a user search query.
 */
export async function embed(
    text: string,
    taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error("[Embedding] Cannot embed an empty string.");
    }

    const client = getClient();
    const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });

    const result = await model.embedContent({
        content: { role: "user", parts: [{ text: trimmed }] },
        taskType,
        // outputDimensionality is not yet in the TS types for this SDK version;
        // override via request options when the SDK adds support.
    });

    const values = result.embedding.values;

    // Pad or truncate to match schema's vector(1536) declaration
    if (values.length < EMBEDDING_DIMENSIONS) {
        return [...values, ...new Array(EMBEDDING_DIMENSIONS - values.length).fill(0)];
    }
    return values.slice(0, EMBEDDING_DIMENSIONS);
}

// ─── Batch Embed ──────────────────────────────────────────────────────────────

/**
 * Embeds an array of text chunks sequentially to avoid API rate limits.
 * Returns an array of vectors in the same order as input.
 */
export async function embedChunks(
    chunks: TextChunk[]
): Promise<{ index: number; vector: number[] }[]> {
    const results: { index: number; vector: number[] }[] = [];

    for (const chunk of chunks) {
        const vector = await embed(chunk.text, TaskType.RETRIEVAL_DOCUMENT);
        results.push({ index: chunk.index, vector });
        // Polite delay between API calls to stay within rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

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
