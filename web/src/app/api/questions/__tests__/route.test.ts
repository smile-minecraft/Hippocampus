/**
 * Integration tests for GET /api/questions
 * Tests difficulty filtering and pagination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

const { mockQuestionFindMany, mockQuestionCount } = vi.hoisted(() => ({
    mockQuestionFindMany: vi.fn(),
    mockQuestionCount: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
    db: {
        question: {
            findMany: mockQuestionFindMany,
            count: mockQuestionCount,
        },
    },
}))

function createRequest(params: Record<string, string>): NextRequest {
    const searchParams = new URLSearchParams(params)
    return new NextRequest(`http://localhost/api/questions?${searchParams.toString()}`)
}

async function getBody<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>
}

describe('GET /api/questions', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.restoreAllMocks())

    describe('difficulty filtering', () => {
        it('filters by single difficulty level', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 3, stem: 'Question 1' },
            ])
            mockQuestionCount.mockResolvedValue(1)

            const res = await GET(createRequest({ difficulty: '3' }))

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { questions: Array<{ difficulty: number }> } }>(res)
            expect(body.ok).toBe(true)
            expect(body.data.questions).toHaveLength(1)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause).toHaveProperty('difficulty')
            expect(whereClause.difficulty).toEqual({ in: [3] })
        })

        it('filters by multiple difficulty levels (comma-separated)', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 1, stem: 'Question 1' },
                { id: 'q2', difficulty: 5, stem: 'Question 2' },
            ])
            mockQuestionCount.mockResolvedValue(2)

            const res = await GET(createRequest({ difficulty: '1,5' }))

            expect(res.status).toBe(200)
            const body = await getBody<{ ok: boolean; data: { questions: Array<{ difficulty: number }> } }>(res)
            expect(body.ok).toBe(true)
            expect(body.data.questions).toHaveLength(2)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause.difficulty).toEqual({ in: [1, 5] })
        })

        it('ignores invalid difficulty values in comma-separated list', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 2, stem: 'Question 1' },
            ])
            mockQuestionCount.mockResolvedValue(1)

            const res = await GET(createRequest({ difficulty: '2,6,0,-1' }))

            expect(res.status).toBe(200)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause.difficulty).toEqual({ in: [2] })
        })

        it('filters out invalid difficulty values (outside 1-5 range)', async () => {
            mockQuestionFindMany.mockResolvedValue([])
            mockQuestionCount.mockResolvedValue(0)

            const res = await GET(createRequest({ difficulty: '6,7,8' }))

            expect(res.status).toBe(200)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause).not.toHaveProperty('difficulty')
        })

        it('returns all questions when difficulty is not specified', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 1, stem: 'Question 1' },
                { id: 'q2', difficulty: 3, stem: 'Question 2' },
                { id: 'q3', difficulty: 5, stem: 'Question 3' },
            ])
            mockQuestionCount.mockResolvedValue(3)

            const res = await GET(createRequest({}))

            expect(res.status).toBe(200)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause).not.toHaveProperty('difficulty')
        })

        it('combines difficulty filter with tag filter', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 3, stem: 'Question 1' },
            ])
            mockQuestionCount.mockResolvedValue(1)

            const res = await GET(createRequest({ difficulty: '3', tagSlugs: 'cardiology' }))

            expect(res.status).toBe(200)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause.difficulty).toEqual({ in: [3] })
            expect(whereClause).toHaveProperty('tags')
        })

        it('combines difficulty filter with year filter', async () => {
            mockQuestionFindMany.mockResolvedValue([
                { id: 'q1', difficulty: 4, year: 2024, stem: 'Question 1' },
            ])
            mockQuestionCount.mockResolvedValue(1)

            const res = await GET(createRequest({ difficulty: '4', year: '2024' }))

            expect(res.status).toBe(200)

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause.difficulty).toEqual({ in: [4] })
            expect(whereClause.year).toBe(2024)
        })
    })

    describe('pagination', () => {
        it('applies default pagination values', async () => {
            mockQuestionFindMany.mockResolvedValue([])
            mockQuestionCount.mockResolvedValue(0)

            await GET(createRequest({}))

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            expect(findManyCall[0]?.skip).toBe(0)
            expect(findManyCall[0]?.take).toBe(20)
        })

        it('applies custom pagination values', async () => {
            mockQuestionFindMany.mockResolvedValue([])
            mockQuestionCount.mockResolvedValue(100)

            await GET(createRequest({ page: '3', limit: '50' }))

            const findManyCall = mockQuestionFindMany.mock.calls[0]
            expect(findManyCall[0]?.skip).toBe(100)
            expect(findManyCall[0]?.take).toBe(50)
        })

        it('rejects limit above 100', async () => {
            const res = await GET(createRequest({ limit: '200' }))

            expect(res.status).toBe(400)
        })

        it('rejects page below 1', async () => {
            const res = await GET(createRequest({ page: '0' }))

            expect(res.status).toBe(400)
        })
    })

    describe('response structure', () => {
        it('returns questions with difficulty field', async () => {
            mockQuestionFindMany.mockResolvedValue([
                {
                    id: 'q1',
                    difficulty: 3,
                    stem: 'Test question',
                    options: { A: 'A', B: 'B', C: 'C', D: 'D' },
                    answer: 'A',
                    tags: [],
                },
            ])
            mockQuestionCount.mockResolvedValue(1)

            const res = await GET(createRequest({}))
            const body = await getBody<{ ok: boolean; data: { questions: Array<{ id: string; difficulty: number; stem: string }> } }>(res)

            expect(body.ok).toBe(true)
            expect(body.data.questions[0]).toHaveProperty('difficulty')
            expect(body.data.questions[0].difficulty).toBe(3)
        })

        it('returns pagination metadata', async () => {
            mockQuestionFindMany.mockResolvedValue([])
            mockQuestionCount.mockResolvedValue(95)

            const res = await GET(createRequest({ limit: '10' }))
            const body = await getBody<{ ok: boolean; data: { pagination: { total: number; page: number; limit: number; totalPages: number } } }>(res)

            expect(body.data.pagination.total).toBe(95)
            expect(body.data.pagination.page).toBe(1)
            expect(body.data.pagination.limit).toBe(10)
            expect(body.data.pagination.totalPages).toBe(10)
        })
    })

    describe('validation', () => {
        it('rejects invalid difficulty format', async () => {
            const res = await GET(createRequest({ difficulty: 'abc' }))

            expect(res.status).toBe(200)
            const findManyCall = mockQuestionFindMany.mock.calls[0]
            const whereClause = findManyCall[0]?.where
            expect(whereClause).not.toHaveProperty('difficulty')
        })

        it('accepts all valid difficulty levels (1-5)', async () => {
            mockQuestionFindMany.mockResolvedValue([])
            mockQuestionCount.mockResolvedValue(0)

            for (const difficulty of ['1', '2', '3', '4', '5']) {
                vi.clearAllMocks()
                mockQuestionFindMany.mockResolvedValue([])
                mockQuestionCount.mockResolvedValue(0)

                const res = await GET(createRequest({ difficulty }))
                expect(res.status).toBe(200)

                const findManyCall = mockQuestionFindMany.mock.calls[0]
                const whereClause = findManyCall[0]?.where
                expect(whereClause.difficulty).toEqual({ in: [parseInt(difficulty)] })
            }
        })
    })
})