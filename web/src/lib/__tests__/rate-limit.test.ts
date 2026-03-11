import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Redis before importing the module under test
// (vi.hoisted runs before vi.mock factory hoisting)
// ---------------------------------------------------------------------------

const { mockRedis } = vi.hoisted(() => ({
    mockRedis: {
        incr: vi.fn(),
        expire: vi.fn(),
        pipeline: vi.fn(),
    },
}))

vi.mock('../redis', () => ({
    redis: new Proxy(mockRedis, {
        get(target, prop) {
            if (prop === 'pipeline') {
                return () => {
                    const commands: Array<{ cmd: string; args: unknown[] }> = []
                    const pipelineProxy = {
                        incr: (...args: unknown[]) => { commands.push({ cmd: 'incr', args }); return pipelineProxy },
                        expire: (...args: unknown[]) => { commands.push({ cmd: 'expire', args }); return pipelineProxy },
                        exec: async () => {
                            // Return mock results for each command
                            return commands.map((c) => {
                                if (c.cmd === 'incr') return [null, mockRedis.incr()]
                                if (c.cmd === 'expire') return [null, mockRedis.expire()]
                                return [null, null]
                            })
                        },
                    }
                    return pipelineProxy
                }
            }
            return (target as Record<string, unknown>)[prop as string]
        },
    }),
}))

vi.mock('@/lib/logger', () => ({
    log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

import { rateLimit, getClientIp, LIMITS, type RateLimitOptions } from '../rate-limit'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks()
    // Default: first request in window (count = 1)
    mockRedis.incr.mockReturnValue(1)
    mockRedis.expire.mockReturnValue(1)
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// rateLimit()
// ---------------------------------------------------------------------------

describe('rateLimit', () => {
    const testOptions: RateLimitOptions = {
        endpoint: 'test',
        windowMs: 60_000,
        maxRequests: 5,
    }

    it('allows the first request', async () => {
        mockRedis.incr.mockReturnValue(1)
        const result = await rateLimit('user-1', testOptions)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(4) // 5 - 1
    })

    it('allows requests up to the limit', async () => {
        mockRedis.incr.mockReturnValue(5) // exactly at limit
        const result = await rateLimit('user-1', testOptions)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(0)
    })

    it('blocks requests exceeding the limit', async () => {
        mockRedis.incr.mockReturnValue(6) // over limit
        const result = await rateLimit('user-1', testOptions)

        expect(result.allowed).toBe(false)
        expect(result.remaining).toBe(0)
    })

    it('returns correct resetAt timestamp', async () => {
        const now = Date.now()
        const windowIndex = Math.floor(now / testOptions.windowMs)
        const expectedResetAt = (windowIndex + 1) * testOptions.windowMs

        const result = await rateLimit('user-1', testOptions)

        // The resetAt should be close to what we calculate
        expect(result.resetAt).toBeGreaterThanOrEqual(expectedResetAt - testOptions.windowMs)
        expect(result.resetAt).toBeLessThanOrEqual(expectedResetAt + testOptions.windowMs)
    })

    it('remaining never goes below 0', async () => {
        mockRedis.incr.mockReturnValue(100) // way over limit
        const result = await rateLimit('user-1', testOptions)

        expect(result.remaining).toBe(0)
    })

    it('fails open when Redis throws', async () => {
        // Override pipeline to throw
        mockRedis.pipeline.mockImplementationOnce(() => ({
            incr: () => ({ expire: () => ({ exec: () => { throw new Error('Redis down') } }) }),
        }))

        // Re-mock pipeline for this test — the module uses redis.pipeline()
        // Since our proxy delegates to mockRedis.pipeline when it's set, we
        // need a different approach. Let's trigger the catch by making exec reject.
        mockRedis.incr.mockImplementation(() => { throw new Error('Redis down') })

        const result = await rateLimit('user-1', testOptions)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(testOptions.maxRequests)
    })
})

// ---------------------------------------------------------------------------
// getClientIp()
// ---------------------------------------------------------------------------

describe('getClientIp', () => {
    function makeRequest(headers: Record<string, string> = {}): Parameters<typeof getClientIp>[0] {
        return {
            headers: {
                get: (key: string) => headers[key.toLowerCase()] ?? null,
            },
        } as Parameters<typeof getClientIp>[0]
    }

    it('prefers x-real-ip when available', () => {
        const req = makeRequest({ 'x-real-ip': '1.2.3.4' })
        expect(getClientIp(req)).toBe('1.2.3.4')
    })

    it('falls back to x-forwarded-for first entry', () => {
        const req = makeRequest({ 'x-forwarded-for': '10.0.0.1, 192.168.1.1' })
        expect(getClientIp(req)).toBe('10.0.0.1')
    })

    it('returns "unknown" when no headers present', () => {
        const req = makeRequest({})
        expect(getClientIp(req)).toBe('unknown')
    })

    it('prefers x-real-ip over x-forwarded-for', () => {
        const req = makeRequest({
            'x-real-ip': '5.5.5.5',
            'x-forwarded-for': '6.6.6.6',
        })
        expect(getClientIp(req)).toBe('5.5.5.5')
    })

    it('handles IPv6 addresses', () => {
        const req = makeRequest({ 'x-real-ip': '::1' })
        expect(getClientIp(req)).toBe('::1')
    })

    it('trims whitespace from x-forwarded-for entries', () => {
        const req = makeRequest({ 'x-forwarded-for': '  7.7.7.7  , 8.8.8.8' })
        expect(getClientIp(req)).toBe('7.7.7.7')
    })
})

// ---------------------------------------------------------------------------
// LIMITS pre-configured constants
// ---------------------------------------------------------------------------

describe('LIMITS', () => {
    it('has login limiter configured', () => {
        expect(LIMITS.login.endpoint).toBe('login')
        expect(LIMITS.login.maxRequests).toBe(10)
        expect(LIMITS.login.windowMs).toBe(15 * 60 * 1000)
    })

    it('has register limiter configured', () => {
        expect(LIMITS.register.endpoint).toBe('register')
        expect(LIMITS.register.maxRequests).toBe(5)
    })

    it('has attempts limiter configured', () => {
        expect(LIMITS.attempts.endpoint).toBe('attempts')
        expect(LIMITS.attempts.maxRequests).toBe(60)
    })

    it('has search limiter configured', () => {
        expect(LIMITS.search.endpoint).toBe('search')
        expect(LIMITS.search.maxRequests).toBe(20)
    })
})
