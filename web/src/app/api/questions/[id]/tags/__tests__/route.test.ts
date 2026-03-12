/**
 * Integration tests for PATCH /api/questions/[id]/tags
 * Tests the single question tag management endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '../route'

const { mockQuestionFindFirst, mockTagFindMany, mockQuestionTagDeleteMany, mockQuestionTagCreateMany, mockQuestionFindUnique, mockTransaction } = vi.hoisted(() => ({
    mockQuestionFindFirst: vi.fn(),
    mockTagFindMany: vi.fn(),
    mockQuestionTagDeleteMany: vi.fn(),
    mockQuestionTagCreateMany: vi.fn(),
    mockQuestionFindUnique: vi.fn(),
    mockTransaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
    db: {
        question: {
            findFirst: mockQuestionFindFirst,
            findUnique: mockQuestionFindUnique,
        },
        tag: { findMany: mockTagFindMany },
        questionTag: {
            deleteMany: mockQuestionTagDeleteMany,
            createMany: mockQuestionTagCreateMany,
        },
        $transaction: mockTransaction,
    },
}))

vi.mock('@/lib/logger', () => ({
    log: { error: vi.fn() },
}))

const MOCK_QUESTION_ID = '11111111-1111-1111-1111-111111111111'
const MOCK_TAG_ID_CARDIOLOGY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const MOCK_TAG_ID_ANATOMY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function createRequest(id: string, body: unknown, role?: string): { request: NextRequest; params: Promise<{ id: string }> } {
    const headers = new Headers()
    if (role) headers.set('x-user-role', role)
    return {
        request: new NextRequest(`http://localhost/api/questions/${id}/tags`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(body),
        }),
        params: Promise.resolve({ id }),
    }
}

async function getBody<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>
}

function createMockTx() {
    return {
        question: {
            findFirst: mockQuestionFindFirst,
            findUnique: mockQuestionFindUnique,
        },
        tag: { findMany: mockTagFindMany },
        questionTag: {
            deleteMany: mockQuestionTagDeleteMany,
            createMany: mockQuestionTagCreateMany,
        },
    }
}

describe('PATCH /api/questions/[id]/tags', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.restoreAllMocks())

    describe('authorization', () => {
        it('returns 403 when x-user-role header is missing', async () => {
            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] })
            const res = await PATCH(request, { params })
            expect(res.status).toBe(403)
            expect((await getBody<{ ok: false; code: string }>(res)).code).toBe('FORBIDDEN')
        })

        it('returns 403 when role is USER', async () => {
            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'USER')
            const res = await PATCH(request, { params })
            expect(res.status).toBe(403)
        })

        it('allows MODERATOR role', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'MODERATOR')
            const res = await PATCH(request, { params })
            expect(res.status).toBe(200)
        })

        it('allows ADMIN role', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })
            expect(res.status).toBe(200)
        })
    })

    describe('validation', () => {
        it('returns 404 when question does not exist', async () => {
            mockQuestionFindFirst.mockResolvedValue(null)

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(404)
            expect((await getBody<{ ok: false; code: string }>(res)).code).toBe('NOT_FOUND')
        })

        it('returns 400 when body is not valid JSON', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            const req = new NextRequest(`http://localhost/api/questions/${MOCK_QUESTION_ID}/tags`, {
                method: 'PATCH',
                headers: { 'x-user-role': 'ADMIN' } as HeadersInit,
            })
            const res = await PATCH(req, { params: Promise.resolve({ id: MOCK_QUESTION_ID }) })
            expect(res.status).toBe(400)
        })

        it('returns 400 when both add and remove are empty', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: [], remove: [] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(400)
        })

        it('returns 400 when neither add nor remove is provided', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })

            const { request, params } = createRequest(MOCK_QUESTION_ID, {}, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(400)
        })

        it('rejects empty string in add array', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([])
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['', 'cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(400)
        })
    })

    describe('success cases', () => {
        beforeEach(() => {
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
        })

        it('adds tags to a question', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology' }])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { id: string; tags: Array<{ slug: string }> } }>(res)
            expect(body.ok).toBe(true)
            expect(body.data.id).toBe(MOCK_QUESTION_ID)
            expect(body.data.tags).toHaveLength(1)
            expect(body.data.tags[0].slug).toBe('cardiology')
        })

        it('removes tags from a question', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_ANATOMY, name: 'Anatomy', slug: 'anatomy' }])
            mockQuestionTagDeleteMany.mockResolvedValue({ count: 1 })
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { remove: ['anatomy'] }, 'MODERATOR')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { id: string; tags: unknown[] } }>(res)
            expect(body.data.tags).toHaveLength(0)
        })

        it('adds and removes tags in one request', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_ANATOMY, name: 'Anatomy', slug: 'anatomy' }])
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology' }])
            mockQuestionTagDeleteMany.mockResolvedValue({ count: 1 })
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'], remove: ['anatomy'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { id: string; tags: Array<{ slug: string }> } }>(res)
            expect(body.data.tags.map((t: { slug: string }) => t.slug)).toContain('cardiology')
        })

        it('ignores non-existent tags silently', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([])
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['non-existent-tag'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { id: string; tags: unknown[] } }>(res)
            expect(body.data.tags).toHaveLength(0)
        })

        it('returns updated question with full tag objects', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([
                { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology' },
                { id: MOCK_TAG_ID_ANATOMY, name: 'Anatomy', slug: 'anatomy' },
            ])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 2 })
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [
                    { tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } },
                    { tag: { id: MOCK_TAG_ID_ANATOMY, name: 'Anatomy', slug: 'anatomy', dimension: 'ACADEMIC', groupName: 'Basic Science' } },
                ],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology', 'anatomy'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { id: string; stem: string; updatedAt: string; tags: Array<{ id: string; name: string; slug: string; dimension: string; groupName: string | null }> } }>(res)
            expect(body.data.tags).toHaveLength(2)
            expect(body.data.tags[0]).toHaveProperty('id')
            expect(body.data.tags[0]).toHaveProperty('name')
            expect(body.data.tags[0]).toHaveProperty('slug')
            expect(body.data.tags[0]).toHaveProperty('dimension')
        })
    })

    describe('error handling', () => {
        it('returns 500 when database transaction fails', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTransaction.mockRejectedValue(new Error('Database error'))

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(500)
            expect((await getBody<{ ok: false; code: string }>(res)).code).toBe('INTERNAL_ERROR')
        })
    })

    describe('integration with ManageQuestionTagsSchema', () => {
        it('accepts add array only', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
        })

        it('accepts remove array only', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_ANATOMY }])
            mockQuestionTagDeleteMany.mockResolvedValue({ count: 1 })
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { remove: ['anatomy'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
        })

        it('accepts both add and remove arrays', async () => {
            mockQuestionFindFirst.mockResolvedValue({ id: MOCK_QUESTION_ID })
            mockTagFindMany
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_ANATOMY }])
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockQuestionTagDeleteMany.mockResolvedValue({ count: 1 })
            mockQuestionTagCreateMany.mockResolvedValue({ count: 1 })
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            mockQuestionFindUnique.mockResolvedValue({
                id: MOCK_QUESTION_ID,
                stem: 'Test question',
                updatedAt: new Date(),
                tags: [{ tag: { id: MOCK_TAG_ID_CARDIOLOGY, name: 'Cardiology', slug: 'cardiology', dimension: 'ACADEMIC', groupName: 'Clinical' } }],
            })

            const { request, params } = createRequest(MOCK_QUESTION_ID, { add: ['cardiology'], remove: ['anatomy'] }, 'ADMIN')
            const res = await PATCH(request, { params })

            expect(res.status).toBe(200)
        })
    })
})