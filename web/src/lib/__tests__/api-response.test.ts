import { describe, it, expect } from 'vitest'
import { ok, created, err, Res } from '../api-response'
import { ZodError, ZodIssueCode } from 'zod'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extractBody<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// ok()
// ---------------------------------------------------------------------------

describe('ok()', () => {
    it('returns 200 with { ok: true, data } by default', async () => {
        const res = ok({ id: '1', name: 'test' })
        expect(res.status).toBe(200)
        const body = await extractBody<{ ok: boolean; data: unknown }>(res)
        expect(body.ok).toBe(true)
        expect(body.data).toEqual({ id: '1', name: 'test' })
    })

    it('accepts a custom status code', async () => {
        const res = ok(null, 202)
        expect(res.status).toBe(202)
    })

    it('handles null data', async () => {
        const res = ok(null)
        const body = await extractBody<{ ok: boolean; data: unknown }>(res)
        expect(body.ok).toBe(true)
        expect(body.data).toBeNull()
    })

    it('handles array data', async () => {
        const res = ok([1, 2, 3])
        const body = await extractBody<{ ok: boolean; data: number[] }>(res)
        expect(body.data).toEqual([1, 2, 3])
    })

    it('sets Content-Type to application/json', () => {
        const res = ok('test')
        expect(res.headers.get('content-type')).toContain('application/json')
    })
})

// ---------------------------------------------------------------------------
// created()
// ---------------------------------------------------------------------------

describe('created()', () => {
    it('returns 201 with { ok: true, data }', async () => {
        const res = created({ id: 'new-id' })
        expect(res.status).toBe(201)
        const body = await extractBody<{ ok: boolean; data: unknown }>(res)
        expect(body.ok).toBe(true)
        expect(body.data).toEqual({ id: 'new-id' })
    })
})

// ---------------------------------------------------------------------------
// err()
// ---------------------------------------------------------------------------

describe('err()', () => {
    it('returns structured error envelope', async () => {
        const res = err('NOT_FOUND', '找不到資源', 404)
        expect(res.status).toBe(404)
        const body = await extractBody<{ ok: boolean; code: string; message: string }>(res)
        expect(body.ok).toBe(false)
        expect(body.code).toBe('NOT_FOUND')
        expect(body.message).toBe('找不到資源')
    })

    it('includes fields when provided', async () => {
        const res = err('VALIDATION_ERROR', '驗證失敗', 400, { email: '格式錯誤' })
        const body = await extractBody<{ fields?: Record<string, string> }>(res)
        expect(body.fields).toEqual({ email: '格式錯誤' })
    })

    it('omits fields when not provided', async () => {
        const res = err('INTERNAL_ERROR', '伺服器錯誤', 500)
        const body = await extractBody<{ fields?: Record<string, string> }>(res)
        expect(body.fields).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// Res convenience shortcuts
// ---------------------------------------------------------------------------

describe('Res shortcuts', () => {
    it('badRequest returns 400 with default message', async () => {
        const res = Res.badRequest()
        expect(res.status).toBe(400)
        const body = await extractBody<{ code: string; message: string }>(res)
        expect(body.code).toBe('VALIDATION_ERROR')
        expect(body.message).toBe('請求格式錯誤')
    })

    it('badRequest accepts custom message', async () => {
        const res = Res.badRequest('自訂錯誤')
        const body = await extractBody<{ message: string }>(res)
        expect(body.message).toBe('自訂錯誤')
    })

    it('unauthorized returns 401', async () => {
        const res = Res.unauthorized()
        expect(res.status).toBe(401)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('UNAUTHORIZED')
    })

    it('forbidden returns 403', async () => {
        const res = Res.forbidden()
        expect(res.status).toBe(403)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('FORBIDDEN')
    })

    it('notFound returns 404', async () => {
        const res = Res.notFound()
        expect(res.status).toBe(404)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('NOT_FOUND')
    })

    it('conflict returns 409', async () => {
        const res = Res.conflict()
        expect(res.status).toBe(409)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('CONFLICT')
    })

    it('rateLimited returns 429', async () => {
        const res = Res.rateLimited()
        expect(res.status).toBe(429)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('RATE_LIMITED')
    })

    it('rateLimited sets Retry-After header when provided', () => {
        const res = Res.rateLimited('太快了', 30)
        expect(res.headers.get('Retry-After')).toBe('30')
    })

    it('rateLimited omits Retry-After when 0 is passed (falsy)', () => {
        const res = Res.rateLimited('太快了', 0)
        expect(res.headers.get('Retry-After')).toBeNull()
    })

    it('rateLimited omits Retry-After when not provided', () => {
        const res = Res.rateLimited()
        expect(res.headers.get('Retry-After')).toBeNull()
    })

    it('internal returns 500', async () => {
        const res = Res.internal()
        expect(res.status).toBe(500)
        const body = await extractBody<{ code: string }>(res)
        expect(body.code).toBe('INTERNAL_ERROR')
    })
})

// ---------------------------------------------------------------------------
// Res.fromZodError
// ---------------------------------------------------------------------------

describe('Res.fromZodError', () => {
    it('converts ZodError into 400 with per-field messages', async () => {
        const zodError = new ZodError([
            {
                code: ZodIssueCode.invalid_type,
                expected: 'string',
                received: 'number',
                path: ['email'],
                message: '必須是字串',
            },
            {
                code: ZodIssueCode.too_small,
                minimum: 8,
                type: 'string',
                inclusive: true,
                exact: false,
                path: ['password'],
                message: '至少 8 個字元',
            },
        ])

        const res = Res.fromZodError(zodError)
        expect(res.status).toBe(400)

        const body = await extractBody<{
            ok: boolean
            code: string
            fields: Record<string, string>
        }>(res)

        expect(body.ok).toBe(false)
        expect(body.code).toBe('VALIDATION_ERROR')
        expect(body.fields).toEqual({
            email: '必須是字串',
            password: '至少 8 個字元',
        })
    })

    it('only surfaces the first error per field', async () => {
        const zodError = new ZodError([
            {
                code: ZodIssueCode.too_small,
                minimum: 8,
                type: 'string',
                inclusive: true,
                exact: false,
                path: ['password'],
                message: '第一個錯誤',
            },
            {
                code: ZodIssueCode.invalid_string,
                validation: 'regex',
                path: ['password'],
                message: '第二個錯誤',
            },
        ])

        const res = Res.fromZodError(zodError)
        const body = await extractBody<{ fields: Record<string, string> }>(res)
        expect(body.fields.password).toBe('第一個錯誤')
    })

    it('handles nested paths with dot notation', async () => {
        const zodError = new ZodError([
            {
                code: ZodIssueCode.invalid_type,
                expected: 'string',
                received: 'undefined',
                path: ['options', 'A'],
                message: 'Required',
            },
        ])

        const res = Res.fromZodError(zodError)
        const body = await extractBody<{ fields: Record<string, string> }>(res)
        expect(body.fields['options.A']).toBe('Required')
    })
})
