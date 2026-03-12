/**
 * lib/cache/explanation-cache.ts — Content-addressed explanation cache
 *
 * Caches AI-generated explanations keyed by a SHA-256 hash of the question
 * content (stem + options + answer). This is path-independent: if the same
 * question appears in different drafts, the cached explanation is reused.
 *
 * Redis key format:  hc:expl:{model}:{sha256hex}
 * TTL: 30 days (explanations are deterministic enough to cache long-term)
 *
 * The cache is model-aware: "fast" and "precise" modes produce different
 * quality explanations, so they are cached separately.
 */

import { createHash } from "node:crypto";
import { redis } from "../redis";
import { log } from "../logger";
import type { ExplanationModelMode } from "../queue/jobs";

const KEY_PREFIX = "hc:expl:";
const TTL_SECONDS = 30 * 24 * 3600; // 30 days

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic SHA-256 hex digest for a question.
 * The hash is computed over a canonical JSON representation to ensure
 * key ordering does not affect the result.
 */
export function questionContentHash(question: {
    stem: string;
    options: Record<string, string>;
    answer: string;
}): string {
    const canonical = JSON.stringify({
        stem: question.stem,
        options: Object.keys(question.options)
            .sort()
            .reduce(
                (acc, k) => {
                    acc[k] = question.options[k];
                    return acc;
                },
                {} as Record<string, string>
            ),
        answer: question.answer,
    });

    return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function redisKey(model: ExplanationModelMode, hash: string): string {
    return `${KEY_PREFIX}${model}:${hash}`;
}

// ---------------------------------------------------------------------------
// Single get/set
// ---------------------------------------------------------------------------

/**
 * Look up a cached explanation by content hash.
 * Returns `null` on cache miss or Redis failure (fail-open).
 */
export async function getExplanation(
    model: ExplanationModelMode,
    hash: string
): Promise<string | null> {
    try {
        return await redis.get(redisKey(model, hash));
    } catch (err) {
        log.warn("explanation-cache", "Redis GET failed", {
            hash,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * Store a generated explanation in the cache.
 * Fire-and-forget semantics — failures are logged but do not propagate.
 */
export async function setExplanation(
    model: ExplanationModelMode,
    hash: string,
    explanation: string
): Promise<void> {
    try {
        await redis.set(redisKey(model, hash), explanation, "EX", TTL_SECONDS);
    } catch (err) {
        log.warn("explanation-cache", "Redis SET failed", {
            hash,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ---------------------------------------------------------------------------
// Batch get/set  (used by the worker for efficiency)
// ---------------------------------------------------------------------------

export interface CacheLookupResult {
    /** Map of index → cached explanation (hits) */
    hits: Map<number, string>;
    /** Indices that were NOT found in cache (misses) */
    misses: number[];
}

/**
 * Batch-lookup explanations for multiple questions.
 * Uses Redis MGET for a single round-trip.
 *
 * @param model   - The LLM mode used
 * @param entries - Array of { index, hash } to look up
 * @returns       - Hits map and miss indices
 */
export async function batchGetExplanations(
    model: ExplanationModelMode,
    entries: Array<{ index: number; hash: string }>
): Promise<CacheLookupResult> {
    const result: CacheLookupResult = { hits: new Map(), misses: [] };

    if (entries.length === 0) return result;

    try {
        const keys = entries.map((e) => redisKey(model, e.hash));
        const values = await redis.mget(...keys);

        for (let i = 0; i < entries.length; i++) {
            const val = values[i];
            if (val !== null) {
                result.hits.set(entries[i].index, val);
            } else {
                result.misses.push(entries[i].index);
            }
        }
    } catch (err) {
        log.warn("explanation-cache", "Redis MGET failed, treating all as misses", {
            count: entries.length,
            error: err instanceof Error ? err.message : String(err),
        });
        // On Redis failure, treat everything as a miss
        for (const e of entries) {
            result.misses.push(e.index);
        }
    }

    return result;
}

/**
 * Batch-store multiple explanations.
 * Uses a Redis pipeline for a single round-trip.
 *
 * @param model   - The LLM mode used
 * @param entries - Array of { hash, explanation } to cache
 */
export async function batchSetExplanations(
    model: ExplanationModelMode,
    entries: Array<{ hash: string; explanation: string }>
): Promise<void> {
    if (entries.length === 0) return;

    try {
        const pipeline = redis.pipeline();
        for (const e of entries) {
            pipeline.set(redisKey(model, e.hash), e.explanation, "EX", TTL_SECONDS);
        }
        await pipeline.exec();
    } catch (err) {
        log.warn("explanation-cache", "Redis pipeline SET failed", {
            count: entries.length,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
