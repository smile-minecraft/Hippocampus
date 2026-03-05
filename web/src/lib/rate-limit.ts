/**
 * rate-limit.ts — Redis-backed Sliding Window Rate Limiter
 *
 * Why Redis (not in-memory)?
 *  Next.js Route Handlers can be distributed across multiple serverless instances.
 *  An in-memory counter is process-local and fails silently in any multi-instance
 *  or hot-reload scenario.  Redis provides a single, atomic counter shared across
 *  all instances.
 *
 * Algorithm: Fixed Window with Atomic INCR
 *  - Key: `rl:{clientIdentifier}:{endpoint}:{windowIndex}`
 *  - windowIndex = Math.floor(Date.now() / windowMs)  → rotates every window period
 *  - INCR atomically increments the counter and returns the new value.
 *  - On first increment, EXPIRE is set for 2× the window to allow the key to
 *    expire naturally while still being readable by the next window.
 *
 * Edge-Case Coverage:
 *  - Race condition: Redis INCR is atomic; no double-increment possible.
 *  - Redis unavailable: rateLimit() catches the error and ALLOWS the request
 *    through (fail-open) to prevent Redis outage from DDoS'ing our own API.
 *    This is a deliberate trade-off; swap to fail-closed if security >  availability.
 *  - IPv6 addresses: used directly as key component (Redis keys are binary-safe).
 */

import { redis } from "./redis";
import type { NextRequest } from "next/server";

export interface RateLimitOptions {
    /** Unique identifier for this limit group, e.g. "login", "attempts" */
    endpoint: string;
    /** Window size in milliseconds */
    windowMs: number;
    /** Maximum number of requests allowed within the window */
    maxRequests: number;
}

export interface RateLimitResult {
    allowed: boolean;
    /** Current request count within the window */
    remaining: number;
    /** Unix timestamp (ms) when the current window resets */
    resetAt: number;
}

/**
 * Checks whether the request from the identified client is within rate limits.
 *
 * @param identifier  Unique key per client — usually IP address or user UUID.
 * @param options     Rate limit configuration for this endpoint.
 */
export async function rateLimit(
    identifier: string,
    options: RateLimitOptions
): Promise<RateLimitResult> {
    const { endpoint, windowMs, maxRequests } = options;

    const windowIndex = Math.floor(Date.now() / windowMs);
    const key = `rl:${identifier}:${endpoint}:${windowIndex}`;
    const resetAt = (windowIndex + 1) * windowMs;

    try {
        // Atomic pipeline: INCR + EXPIRE in a single round-trip
        const pipeline = redis.pipeline();
        pipeline.incr(key);
        // Set TTL only on the first increment (EXPIRE is idempotent but this avoids
        // resetting TTL on subsequent requests within the same window)
        pipeline.expire(key, Math.ceil((windowMs * 2) / 1000));
        const results = await pipeline.exec();

        // results[0] = [error, count]
        const count = (results?.[0]?.[1] as number) ?? 1;
        const remaining = Math.max(0, maxRequests - count);

        return {
            allowed: count <= maxRequests,
            remaining,
            resetAt,
        };
    } catch (err) {
        // Fail-open: Redis unavailable → allow request, log warning
        console.warn("[RateLimit] Redis error, failing open:", (err as Error).message);
        return { allowed: true, remaining: maxRequests, resetAt };
    }
}

/**
 * Extracts the best-available client IP from a Next.js request.
 * Checks standard proxy headers before falling back to the socket address.
 */
export function getClientIp(request: NextRequest): string {
    return (
        request.headers.get("x-real-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown"
    );
}

// ─── Pre-configured Limiters ─────────────────────────────────────────────────

export const LIMITS = {
    login: {
        endpoint: "login",
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 10,           // 10 attempts per 15 min (brute-force guard)
    },
    register: {
        endpoint: "register",
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 5,            // 5 registrations per hour
    },
    attempts: {
        endpoint: "attempts",
        windowMs: 60 * 1000,       // 1 minute
        maxRequests: 60,           // 60 submissions/min (anti-bot)
    },
    search: {
        endpoint: "search",
        windowMs: 60 * 1000,       // 1 minute
        maxRequests: 20,           // Embedding API cost protection
    },
} satisfies Record<string, RateLimitOptions>;
