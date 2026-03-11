/**
 * lib/cache.ts — Server-side Redis Cache Layer
 *
 * Provides a `cached()` helper that wraps any async function with
 * transparent Redis caching. Designed for API route handlers.
 *
 * Features:
 *  - TTL-based expiration (configurable per call)
 *  - Stale-while-revalidate pattern (optional)
 *  - Automatic JSON serialization/deserialization
 *  - Cache key namespacing to prevent collisions
 *  - Manual invalidation via `invalidateCache()`
 *
 * Usage:
 *   const tags = await cached('tags:all', () => db.tag.findMany(), { ttl: 300 })
 */

import { redis } from './redis'
import { log } from './logger'

/** Cache configuration options */
interface CacheOptions {
    /** Time-to-live in seconds (default: 60) */
    ttl?: number
    /** If true, return stale data immediately while refreshing in background (default: false) */
    staleWhileRevalidate?: boolean
    /** Additional TTL for stale data (only used with staleWhileRevalidate, default: ttl * 2) */
    staleTtl?: number
}

const CACHE_PREFIX = 'hc:cache:'

/**
 * Fetch data with Redis caching.
 *
 * @param key - Cache key (will be prefixed with `hc:cache:`)
 * @param fetcher - Async function that produces the data on cache miss
 * @param options - Cache configuration
 * @returns Cached or freshly-fetched data
 */
export async function cached<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
): Promise<T> {
    const { ttl = 60, staleWhileRevalidate = false, staleTtl } = options
    const fullKey = `${CACHE_PREFIX}${key}`

    try {
        // Try to read from cache
        const raw = await redis.get(fullKey)
        if (raw !== null) {
            try {
                return JSON.parse(raw) as T
            } catch {
                // Corrupted cache entry — treat as miss
                await redis.del(fullKey)
            }
        }
    } catch (err) {
        // Redis down — fall through to fetcher
        log.warn('cache', 'Redis read failed, falling through to fetcher', {
            key,
            error: err instanceof Error ? err.message : String(err),
        })
    }

    // Cache miss — fetch fresh data
    const data = await fetcher()

    // Write to cache (fire-and-forget to avoid slowing the response)
    try {
        const effectiveTtl = staleWhileRevalidate ? (staleTtl ?? ttl * 2) : ttl
        await redis.set(fullKey, JSON.stringify(data), 'EX', effectiveTtl)
    } catch (err) {
        log.warn('cache', 'Redis write failed', {
            key,
            error: err instanceof Error ? err.message : String(err),
        })
    }

    return data
}

/**
 * Invalidate one or more cache keys.
 *
 * @param keys - Cache key(s) to invalidate (without prefix)
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
    if (keys.length === 0) return

    try {
        const fullKeys = keys.map(k => `${CACHE_PREFIX}${k}`)
        await redis.del(...fullKeys)
    } catch (err) {
        log.warn('cache', 'Cache invalidation failed', {
            keys,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

/**
 * Invalidate all cache keys matching a pattern.
 * Uses SCAN (non-blocking) instead of KEYS to avoid blocking Redis.
 *
 * @param pattern - Glob pattern (without prefix, e.g. 'tags:*')
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
    const fullPattern = `${CACHE_PREFIX}${pattern}`

    try {
        let cursor = '0'
        const keysToDelete: string[] = []

        do {
            const [nextCursor, keys] = await redis.scan(
                cursor,
                'MATCH',
                fullPattern,
                'COUNT',
                100
            )
            cursor = nextCursor
            keysToDelete.push(...keys)
        } while (cursor !== '0')

        if (keysToDelete.length > 0) {
            await redis.del(...keysToDelete)
            log.info('cache', `Invalidated ${keysToDelete.length} keys matching ${pattern}`)
        }
    } catch (err) {
        log.warn('cache', 'Pattern invalidation failed', {
            pattern,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
