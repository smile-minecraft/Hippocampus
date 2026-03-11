import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Redis (vi.hoisted runs before vi.mock factory hoisting)
// ---------------------------------------------------------------------------

const { mockRedis } = vi.hoisted(() => ({
    mockRedis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        scan: vi.fn(),
    },
}))

vi.mock('../redis', () => ({
    redis: mockRedis,
}))

vi.mock('../logger', () => ({
    log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

import { cached, invalidateCache, invalidateCachePattern } from '../cache'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks()
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// cached()
// ---------------------------------------------------------------------------

describe('cached', () => {
    it('returns cached data on cache hit', async () => {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify({ count: 42 }))

        const fetcher = vi.fn()
        const result = await cached('test-key', fetcher)

        expect(result).toEqual({ count: 42 })
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('calls fetcher on cache miss and stores result', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue({ fresh: true })
        const result = await cached('miss-key', fetcher, { ttl: 120 })

        expect(result).toEqual({ fresh: true })
        expect(fetcher).toHaveBeenCalledOnce()
        expect(mockRedis.set).toHaveBeenCalledWith(
            'hc:cache:miss-key',
            JSON.stringify({ fresh: true }),
            'EX',
            120,
        )
    })

    it('uses default TTL of 60 seconds', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue('data')
        await cached('default-ttl', fetcher)

        expect(mockRedis.set).toHaveBeenCalledWith(
            'hc:cache:default-ttl',
            JSON.stringify('data'),
            'EX',
            60,
        )
    })

    it('uses staleTtl (2x ttl) when staleWhileRevalidate is enabled', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue('data')
        await cached('swr-key', fetcher, { ttl: 100, staleWhileRevalidate: true })

        // staleTtl defaults to ttl * 2 = 200
        expect(mockRedis.set).toHaveBeenCalledWith(
            'hc:cache:swr-key',
            JSON.stringify('data'),
            'EX',
            200,
        )
    })

    it('uses custom staleTtl when provided', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue('data')
        await cached('custom-stale', fetcher, {
            ttl: 100,
            staleWhileRevalidate: true,
            staleTtl: 500,
        })

        expect(mockRedis.set).toHaveBeenCalledWith(
            'hc:cache:custom-stale',
            JSON.stringify('data'),
            'EX',
            500,
        )
    })

    it('deletes corrupted cache entry and falls through to fetcher', async () => {
        mockRedis.get.mockResolvedValueOnce('not-valid-json{{{')
        mockRedis.del.mockResolvedValueOnce(1)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue({ recovered: true })
        const result = await cached('corrupt-key', fetcher)

        expect(mockRedis.del).toHaveBeenCalledWith('hc:cache:corrupt-key')
        expect(result).toEqual({ recovered: true })
        expect(fetcher).toHaveBeenCalledOnce()
    })

    it('falls through to fetcher when Redis read fails (fail-open)', async () => {
        mockRedis.get.mockRejectedValueOnce(new Error('Connection refused'))
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue({ fallback: true })
        const result = await cached('redis-down', fetcher)

        expect(result).toEqual({ fallback: true })
        expect(fetcher).toHaveBeenCalledOnce()
    })

    it('still returns data even when Redis write fails', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockRejectedValueOnce(new Error('Write failed'))

        const fetcher = vi.fn().mockResolvedValue({ data: 'ok' })
        const result = await cached('write-fail', fetcher)

        expect(result).toEqual({ data: 'ok' })
    })

    it('namespaces keys with hc:cache: prefix', async () => {
        mockRedis.get.mockResolvedValueOnce(null)
        mockRedis.set.mockResolvedValueOnce('OK')

        const fetcher = vi.fn().mockResolvedValue(null)
        await cached('my-key', fetcher)

        expect(mockRedis.get).toHaveBeenCalledWith('hc:cache:my-key')
    })
})

// ---------------------------------------------------------------------------
// invalidateCache()
// ---------------------------------------------------------------------------

describe('invalidateCache', () => {
    it('deletes the specified cache key(s)', async () => {
        mockRedis.del.mockResolvedValueOnce(1)

        await invalidateCache('key1', 'key2')

        expect(mockRedis.del).toHaveBeenCalledWith(
            'hc:cache:key1',
            'hc:cache:key2',
        )
    })

    it('does nothing when called with no keys', async () => {
        await invalidateCache()
        expect(mockRedis.del).not.toHaveBeenCalled()
    })

    it('does not throw when Redis delete fails', async () => {
        mockRedis.del.mockRejectedValueOnce(new Error('Del failed'))

        await expect(invalidateCache('bad-key')).resolves.toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// invalidateCachePattern()
// ---------------------------------------------------------------------------

describe('invalidateCachePattern', () => {
    it('scans and deletes matching keys', async () => {
        // First scan returns keys, cursor moves to 0 (end)
        mockRedis.scan.mockResolvedValueOnce(['0', ['hc:cache:tags:1', 'hc:cache:tags:2']])
        mockRedis.del.mockResolvedValueOnce(2)

        await invalidateCachePattern('tags:*')

        expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'hc:cache:tags:*', 'COUNT', 100)
        expect(mockRedis.del).toHaveBeenCalledWith('hc:cache:tags:1', 'hc:cache:tags:2')
    })

    it('handles multiple scan iterations', async () => {
        // First scan: returns cursor '5' (not done)
        mockRedis.scan.mockResolvedValueOnce(['5', ['hc:cache:x:1']])
        // Second scan: returns cursor '0' (done)
        mockRedis.scan.mockResolvedValueOnce(['0', ['hc:cache:x:2']])
        mockRedis.del.mockResolvedValueOnce(2)

        await invalidateCachePattern('x:*')

        expect(mockRedis.scan).toHaveBeenCalledTimes(2)
        expect(mockRedis.del).toHaveBeenCalledWith('hc:cache:x:1', 'hc:cache:x:2')
    })

    it('does not call del when no keys match', async () => {
        mockRedis.scan.mockResolvedValueOnce(['0', []])

        await invalidateCachePattern('nonexistent:*')

        expect(mockRedis.del).not.toHaveBeenCalled()
    })

    it('does not throw when scan fails', async () => {
        mockRedis.scan.mockRejectedValueOnce(new Error('Scan failed'))

        await expect(invalidateCachePattern('broken:*')).resolves.toBeUndefined()
    })
})
