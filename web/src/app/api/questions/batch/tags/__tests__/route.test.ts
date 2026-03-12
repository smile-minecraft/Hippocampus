import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from '../route'

const { mockTagFindMany, mockQuestionFindMany, mockQuestionTagDeleteMany, mockQuestionTagCreateMany, mockTransaction } = vi.hoisted(() => ({
    mockTagFindMany: vi.fn(),
    mockQuestionFindMany: vi.fn(),
    mockQuestionTagDeleteMany: vi.fn(),
    mockQuestionTagCreateMany: vi.fn(),
    mockTransaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
    db: {
        tag: { findMany: mockTagFindMany },
        question: { findMany: mockQuestionFindMany },
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

const MOCK_QUESTION_ID_1 = '11111111-1111-1111-1111-111111111111'
const MOCK_QUESTION_ID_2 = '22222222-2222-2222-2222-222222222222'
const MOCK_QUESTION_ID_3 = '33333333-3333-3333-3333-333333333333'
const MOCK_TAG_ID_CARDIOLOGY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const MOCK_TAG_ID_ANATOMY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function createRequest(body: unknown, role?: string): Request {
    const headers = new Headers()
    if (role) headers.set('x-user-role', role)
    return new Request('http://localhost/api/questions/batch/tags', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    })
}

async function getBody<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>
}

function createMockTx() {
    return {
        tag: { findMany: mockTagFindMany },
        question: { findMany: mockQuestionFindMany },
        questionTag: {
            deleteMany: mockQuestionTagDeleteMany,
            createMany: mockQuestionTagCreateMany,
        },
    }
}

describe('POST /api/questions/batch/tags', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.restoreAllMocks())

    describe('authorization', () => {
        it('returns 403 when x-user-role header is missing', async () => {
            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1], add: ['cardiology'] }))
            expect(res.status).toBe(403)
            expect((await getBody<{ ok: false; code: string }>(res)).code).toBe('FORBIDDEN')
        })

        it('returns 403 when role is USER', async () => {
            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1], add: ['cardiology'] }, 'USER'))
            expect(res.status).toBe(403)
        })

        it('allows MODERATOR role', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1], add: ['cardiology'] }, 'MODERATOR'))
            expect(res.status).toBe(200)
        })

        it('allows ADMIN role', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1], add: ['cardiology'] }, 'ADMIN'))
            expect(res.status).toBe(200)
        })
    })

    describe('validation', () => {
        it('returns 400 when questionIds is empty', async () => {
            const res = await POST(createRequest({ questionIds: [], add: ['cardiology'] }, 'ADMIN'))
            expect(res.status).toBe(400)
        })

        it('returns 400 when questionIds contains invalid UUID', async () => {
            const res = await POST(createRequest({ questionIds: ['not-a-uuid'], add: ['cardiology'] }, 'ADMIN'))
            expect(res.status).toBe(400)
        })

        it('returns 400 when both add and remove are empty', async () => {
            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1] }, 'ADMIN'))
            expect(res.status).toBe(400)
        })

        it('returns 400 when body is not valid JSON', async () => {
            const req = new Request('http://localhost/api/questions/batch/tags', {
                method: 'POST',
                headers: { 'x-user-role': 'ADMIN' } as HeadersInit,
                body: 'not json',
            })
            const res = await POST(req)
            expect(res.status).toBe(400)
        })

        it('limits questionIds to 100 items', async () => {
            const res = await POST(createRequest({ questionIds: Array(101).fill(MOCK_QUESTION_ID_1), add: ['cardiology'] }, 'ADMIN'))
            expect(res.status).toBe(400)
        })
    })

    describe('success cases', () => {
        beforeEach(() => {
            mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(createMockTx()))
        })

        it('adds tags to multiple questions', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }, { id: MOCK_QUESTION_ID_2 }, { id: MOCK_QUESTION_ID_3 }])
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])
            mockQuestionTagCreateMany.mockResolvedValue({ count: 3 })

            const res = await POST(createRequest({
                questionIds: [MOCK_QUESTION_ID_1, MOCK_QUESTION_ID_2, MOCK_QUESTION_ID_3],
                add: ['cardiology'],
            }, 'ADMIN'))

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { affectedCount: number } }>(res)
            expect(body.ok).toBe(true)
            expect(body.data.affectedCount).toBe(3)
        })

        it('removes tags from multiple questions', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }, { id: MOCK_QUESTION_ID_2 }])
            mockTagFindMany.mockResolvedValueOnce([{ id: MOCK_TAG_ID_ANATOMY }])
            mockQuestionTagDeleteMany.mockResolvedValue({ count: 2 })

            const res = await POST(createRequest({
                questionIds: [MOCK_QUESTION_ID_1, MOCK_QUESTION_ID_2],
                remove: ['anatomy'],
            }, 'MODERATOR'))

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { affectedCount: number } }>(res)
            expect(body.data.affectedCount).toBe(2)
        })

        it('adds and removes tags in one request', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTagFindMany
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_ANATOMY }])
                .mockResolvedValueOnce([{ id: MOCK_TAG_ID_CARDIOLOGY }])

            const res = await POST(createRequest({
                questionIds: [MOCK_QUESTION_ID_1],
                add: ['cardiology'],
                remove: ['anatomy'],
            }, 'ADMIN'))

            expect(res.status).toBe(200)
            expect((await getBody<{ data: { affectedCount: number } }>(res)).data.affectedCount).toBe(1)
        })

        it('ignores non-existent tags silently', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTagFindMany.mockResolvedValue([])

            const res = await POST(createRequest({
                questionIds: [MOCK_QUESTION_ID_1],
                add: ['non-existent'],
            }, 'ADMIN'))

            expect(res.status).toBe(200)
            expect((await getBody<{ data: { affectedCount: number } }>(res)).data.affectedCount).toBe(1)
        })

        it('only processes existing questions', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTagFindMany.mockResolvedValue([{ id: MOCK_TAG_ID_CARDIOLOGY }])

            const res = await POST(createRequest({
                questionIds: [MOCK_QUESTION_ID_1, MOCK_QUESTION_ID_2, MOCK_QUESTION_ID_3],
                add: ['cardiology'],
            }, 'ADMIN'))

            expect((await getBody<{ data: { affectedCount: number } }>(res)).data.affectedCount).toBe(1)
        })
    })

    describe('error handling', () => {
        it('returns 500 when database transaction fails', async () => {
            mockQuestionFindMany.mockResolvedValue([{ id: MOCK_QUESTION_ID_1 }])
            mockTransaction.mockRejectedValue(new Error('Database error'))

            const res = await POST(createRequest({ questionIds: [MOCK_QUESTION_ID_1], add: ['cardiology'] }, 'ADMIN'))

            expect(res.status).toBe(500)
            expect((await getBody<{ ok: false; code: string }>(res)).code).toBe('INTERNAL_ERROR')
        })
    })
})
