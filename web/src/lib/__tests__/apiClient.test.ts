import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchApi, ApiClientError } from '../apiClient'

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('document', undefined) // server-side by default
    mockFetch.mockReset()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

// ---------------------------------------------------------------------------
// fetchApi core
// ---------------------------------------------------------------------------

describe('fetchApi', () => {
    it('returns data on successful { ok: true, data } response', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: '1' } }))

        const result = await fetchApi<{ id: string }>('/api/test')
        expect(result).toEqual({ id: '1' })
    })

    it('sends Content-Type: application/json by default', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))

        await fetchApi('/api/test')

        const [, init] = mockFetch.mock.calls[0]
        expect(init.headers['Content-Type']).toBe('application/json')
    })

    it('includes credentials: include', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))

        await fetchApi('/api/test')

        const [, init] = mockFetch.mock.calls[0]
        expect(init.credentials).toBe('include')
    })

    // ─── Error handling ────────────────────────────────────────────────

    it('throws ApiClientError on non-2xx with { error: string }', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, error: '未找到' }, 404),
        )

        await expect(fetchApi('/api/missing'))
            .rejects
            .toThrow(ApiClientError)

        try {
            await fetchApi('/api/missing')
        } catch (_e) {
            // Won't reach here since mockFetch is consumed, but pattern is correct
        }
    })

    it('extracts error message from { error: { message } } shape', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, error: { message: '伺服器錯誤', code: 'SERVER_ERROR' } }, 500),
        )

        try {
            await fetchApi('/api/broken')
            expect.fail('should have thrown')
        } catch (e) {
            expect(e).toBeInstanceOf(ApiClientError)
            const err = e as ApiClientError
            expect(err.message).toBe('伺服器錯誤')
            expect(err.code).toBe('SERVER_ERROR')
            expect(err.statusCode).toBe(500)
        }
    })

    it('extracts error message from { message } shape', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, message: '直接訊息' }, 400),
        )

        try {
            await fetchApi('/api/bad')
            expect.fail('should have thrown')
        } catch (e) {
            const err = e as ApiClientError
            expect(err.message).toBe('直接訊息')
        }
    })

    it('throws ApiClientError for non-JSON response', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('<html>Bad Gateway</html>', { status: 502 }),
        )

        try {
            await fetchApi('/api/proxy')
            expect.fail('should have thrown')
        } catch (e) {
            expect(e).toBeInstanceOf(ApiClientError)
            const err = e as ApiClientError
            expect(err.code).toBe('UNKNOWN_ERROR')
            expect(err.statusCode).toBe(502)
        }
    })

    // ─── 401 auto-refresh ──────────────────────────────────────────────

    it('retries after 401 with auto token refresh', async () => {
        // First call: 401
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, error: 'Unauthorized' }, 401),
        )
        // Refresh call: success
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: true }, 200),
        )
        // Retry: success
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: true, data: { retried: true } }, 200),
        )

        const result = await fetchApi<{ retried: boolean }>('/api/protected')
        expect(result).toEqual({ retried: true })
        expect(mockFetch).toHaveBeenCalledTimes(3)

        // Verify refresh was called with POST to /api/auth/refresh
        const [refreshUrl, refreshInit] = mockFetch.mock.calls[1]
        expect(refreshUrl).toContain('/api/auth/refresh')
        expect(refreshInit.method).toBe('POST')
    })

    it('does not retry infinitely — x-is-retry header prevents loop', async () => {
        // First call: 401
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, error: 'Unauthorized' }, 401),
        )
        // Refresh: success
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: true }, 200),
        )
        // Retry also returns 401 — should NOT trigger another refresh
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ ok: false, error: 'Still unauthorized' }, 401),
        )

        await expect(fetchApi('/api/protected'))
            .rejects
            .toThrow(ApiClientError)

        // Should be exactly 3 calls: original + refresh + retry (no more)
        expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    // ─── CSRF token ────────────────────────────────────────────────────

    it('sends CSRF token from cookie on mutating requests', async () => {
        // Simulate browser environment with cookie
        vi.stubGlobal('document', { cookie: '__csrf_token=abc123; other=val' })

        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))

        await fetchApi('/api/data', { method: 'POST', body: '{}' })

        const [, init] = mockFetch.mock.calls[0]
        expect(init.headers['x-csrf-token']).toBe('abc123')
    })

    it('does not send CSRF token on GET requests', async () => {
        vi.stubGlobal('document', { cookie: '__csrf_token=abc123' })

        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))

        await fetchApi('/api/data') // default GET

        const [, init] = mockFetch.mock.calls[0]
        expect(init.headers['x-csrf-token']).toBeUndefined()
    })

    // ─── FormData ──────────────────────────────────────────────────────

    it('omits Content-Type header when body is FormData', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))

        const formData = new FormData()
        formData.append('file', new Blob(['hello']), 'test.txt')

        await fetchApi('/api/upload', { method: 'POST', body: formData })

        const [, init] = mockFetch.mock.calls[0]
        // When FormData, Content-Type should not be set (browser sets multipart boundary)
        const ct = init.headers?.['Content-Type']
        expect(ct).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// ApiClientError
// ---------------------------------------------------------------------------

describe('ApiClientError', () => {
    it('has correct name and properties', () => {
        const err = new ApiClientError('NOT_FOUND', '找不到', 404)
        expect(err.name).toBe('ApiClientError')
        expect(err.code).toBe('NOT_FOUND')
        expect(err.message).toBe('找不到')
        expect(err.statusCode).toBe(404)
        expect(err).toBeInstanceOf(Error)
    })
})
