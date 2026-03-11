import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock jose (jwtVerify)
// ---------------------------------------------------------------------------

const { mockJwtVerify } = vi.hoisted(() => ({
    mockJwtVerify: vi.fn(),
}))

vi.mock('jose', () => ({
    jwtVerify: mockJwtVerify,
}))

// ---------------------------------------------------------------------------
// Mock NextResponse / NextRequest from next/server.
// We use lightweight fakes since the real ones need the Edge Runtime.
// ---------------------------------------------------------------------------

class FakeHeaders {
    private _map = new Map<string, string>()
    constructor(init?: HeadersInit) {
        if (init instanceof FakeHeaders) {
            init._map.forEach((v, k) => this._map.set(k, v))
        } else if (init && typeof init === 'object' && Symbol.iterator in init) {
            for (const [k, v] of init as Iterable<[string, string]>) {
                this._map.set(k.toLowerCase(), v)
            }
        } else if (init && typeof init === 'object') {
            for (const [k, v] of Object.entries(init)) {
                this._map.set(k.toLowerCase(), v)
            }
        }
    }
    get(key: string) { return this._map.get(key.toLowerCase()) ?? null }
    set(key: string, value: string) { this._map.set(key.toLowerCase(), value) }
    delete(key: string) { this._map.delete(key.toLowerCase()) }
    has(key: string) { return this._map.has(key.toLowerCase()) }
    forEach(cb: (v: string, k: string) => void) { this._map.forEach(cb) }
}

interface FakeNextRequest {
    method: string
    nextUrl: { pathname: string }
    headers: FakeHeaders
    cookies: { get: (name: string) => { value: string } | undefined }
}

function makeRequest(opts: {
    method?: string
    pathname?: string
    accessToken?: string
    csrfCookie?: string
    csrfHeader?: string
    extraHeaders?: Record<string, string>
}): FakeNextRequest {
    const headers = new FakeHeaders(opts.extraHeaders ?? {})
    if (opts.csrfHeader) headers.set('x-csrf-token', opts.csrfHeader)

    const cookies = new Map<string, string>()
    if (opts.accessToken) cookies.set('access_token', opts.accessToken)
    if (opts.csrfCookie) cookies.set('__csrf_token', opts.csrfCookie)

    return {
        method: opts.method ?? 'GET',
        nextUrl: { pathname: opts.pathname ?? '/api/protected' },
        headers,
        cookies: {
            get: (name: string) => {
                const v = cookies.get(name)
                return v !== undefined ? { value: v } : undefined
            },
        },
    }
}

// We need to track what NextResponse.json and NextResponse.next are called with
let lastJsonArgs: { body: unknown; init: { status: number } } | null = null
let lastNextArgs: { request?: { headers: unknown } } | null = null

vi.mock('next/server', () => ({
    NextResponse: {
        json: (body: unknown, init: { status: number }) => {
            lastJsonArgs = { body, init }
            return { type: 'json', body, status: init.status }
        },
        next: (opts?: { request?: { headers: unknown } }) => {
            lastNextArgs = opts ?? null
            return { type: 'next', opts }
        },
    },
}))

import { proxy } from '../proxy'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks()
    lastJsonArgs = null
    lastNextArgs = null
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Public routes bypass JWT check
// ---------------------------------------------------------------------------

describe('public routes', () => {
    it('passes through /api/auth/* without requiring a token', async () => {
        const req = makeRequest({ pathname: '/api/auth/login', method: 'POST' })
        const res = await proxy(req as never)

        expect((res as { type: string }).type).toBe('next')
        expect(lastJsonArgs).toBeNull()
    })

    it('passes through /api/questions without requiring a token', async () => {
        const req = makeRequest({ pathname: '/api/questions', method: 'GET' })
        const res = await proxy(req as never)

        expect((res as { type: string }).type).toBe('next')
    })

    it('passes through /api/tags without requiring a token', async () => {
        const req = makeRequest({ pathname: '/api/tags', method: 'GET' })
        const res = await proxy(req as never)

        expect((res as { type: string }).type).toBe('next')
    })
})

// ---------------------------------------------------------------------------
// Header stripping (prevents x-user-id spoofing)
// ---------------------------------------------------------------------------

describe('header stripping', () => {
    it('strips x-user-id and x-user-role from incoming request on public routes', async () => {
        const req = makeRequest({
            pathname: '/api/auth/login',
            extraHeaders: { 'x-user-id': 'spoofed', 'x-user-role': 'ADMIN' },
        })
        await proxy(req as never)

        // The headers passed to NextResponse.next should NOT have the spoofed values
        expect(lastNextArgs).not.toBeNull()
        const passedHeaders = (lastNextArgs?.request as { headers: FakeHeaders })?.headers
        expect(passedHeaders?.get('x-user-id')).toBeNull()
        expect(passedHeaders?.get('x-user-role')).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// Missing token → 401
// ---------------------------------------------------------------------------

describe('protected routes without token', () => {
    it('returns 401 when access_token cookie is missing', async () => {
        const req = makeRequest({ pathname: '/api/protected', method: 'GET' })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(401)
        expect((lastJsonArgs?.body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED')
    })
})

// ---------------------------------------------------------------------------
// Valid token → passes through with injected headers
// ---------------------------------------------------------------------------

describe('valid token', () => {
    beforeEach(() => {
        mockJwtVerify.mockResolvedValue({
            payload: { sub: 'user-123', role: 'ADMIN' },
        })
    })

    it('injects x-user-id and x-user-role headers', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'GET',
            accessToken: 'valid-jwt',
        })
        await proxy(req as never)

        expect(lastNextArgs).not.toBeNull()
        const passedHeaders = (lastNextArgs?.request as { headers: FakeHeaders })?.headers
        expect(passedHeaders?.get('x-user-id')).toBe('user-123')
        expect(passedHeaders?.get('x-user-role')).toBe('ADMIN')
    })

    it('defaults role to USER when token has no role claim', async () => {
        mockJwtVerify.mockResolvedValue({
            payload: { sub: 'user-456' },
        })

        const req = makeRequest({
            pathname: '/api/protected',
            method: 'GET',
            accessToken: 'valid-jwt',
        })
        await proxy(req as never)

        const passedHeaders = (lastNextArgs?.request as { headers: FakeHeaders })?.headers
        expect(passedHeaders?.get('x-user-role')).toBe('USER')
    })

    it('returns 401 when token has no sub claim', async () => {
        mockJwtVerify.mockResolvedValue({
            payload: { role: 'ADMIN' }, // no sub
        })

        const req = makeRequest({
            pathname: '/api/protected',
            method: 'GET',
            accessToken: 'jwt-no-sub',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(401)
    })
})

// ---------------------------------------------------------------------------
// CSRF validation on state-mutating methods
// ---------------------------------------------------------------------------

describe('CSRF validation', () => {
    beforeEach(() => {
        mockJwtVerify.mockResolvedValue({
            payload: { sub: 'user-123', role: 'USER' },
        })
    })

    it('allows POST when CSRF cookie and header match', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'POST',
            accessToken: 'valid-jwt',
            csrfCookie: 'token-abc',
            csrfHeader: 'token-abc',
        })
        const res = await proxy(req as never)

        expect((res as { type: string }).type).toBe('next')
    })

    it('blocks POST when CSRF cookie is missing', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'POST',
            accessToken: 'valid-jwt',
            csrfHeader: 'token-abc',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(403)
        expect((lastJsonArgs?.body as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    })

    it('blocks POST when CSRF header is missing', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'POST',
            accessToken: 'valid-jwt',
            csrfCookie: 'token-abc',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(403)
    })

    it('blocks when CSRF cookie and header do not match', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'POST',
            accessToken: 'valid-jwt',
            csrfCookie: 'token-aaa',
            csrfHeader: 'token-bbb',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(403)
    })

    it('does not require CSRF for GET requests', async () => {
        const req = makeRequest({
            pathname: '/api/protected',
            method: 'GET',
            accessToken: 'valid-jwt',
            // no CSRF tokens
        })
        const res = await proxy(req as never)

        expect((res as { type: string }).type).toBe('next')
    })

    for (const method of ['PUT', 'DELETE', 'PATCH']) {
        it(`validates CSRF on ${method} requests`, async () => {
            const req = makeRequest({
                pathname: '/api/protected',
                method,
                accessToken: 'valid-jwt',
                // no CSRF tokens
            })
            const res = await proxy(req as never)

            expect((res as { status: number }).status).toBe(403)
        })
    }
})

// ---------------------------------------------------------------------------
// Expired / invalid tokens
// ---------------------------------------------------------------------------

describe('token errors', () => {
    it('returns 401 with expiry message for JWTExpired error', async () => {
        const err = new Error('JWT expired')
        err.name = 'JWTExpired'
        mockJwtVerify.mockRejectedValue(err)

        const req = makeRequest({
            pathname: '/api/protected',
            accessToken: 'expired-jwt',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(401)
        expect((lastJsonArgs?.body as { error: { message: string } }).error.message).toContain('過期')
    })

    it('returns 401 with generic message for invalid token', async () => {
        mockJwtVerify.mockRejectedValue(new Error('JWS verification failed'))

        const req = makeRequest({
            pathname: '/api/protected',
            accessToken: 'tampered-jwt',
        })
        const res = await proxy(req as never)

        expect((res as { status: number }).status).toBe(401)
        expect((lastJsonArgs?.body as { error: { message: string } }).error.message).toContain('無效')
    })

    it('detects expired token via error message containing "exp"', async () => {
        mockJwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'))

        const req = makeRequest({
            pathname: '/api/protected',
            accessToken: 'expired-jwt',
        })
        const res = await proxy(req as never)

        expect((lastJsonArgs?.body as { error: { message: string } }).error.message).toContain('過期')
    })
})
