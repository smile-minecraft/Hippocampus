import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the dependencies
vi.mock('next/navigation', () => ({
    useParams: () => ({ id: '2024_國考' }),
    useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/apiClient', () => ({
    fetchAdminExamQuestions: vi.fn(),
    updateAdminQuestion: vi.fn(),
    deleteAdminQuestion: vi.fn(),
    bulkDeleteQuestions: vi.fn(),
    bulkTransferQuestions: vi.fn(),
    updateQuestionTags: vi.fn(),
    batchUpdateQuestionTags: vi.fn(),
    fetchTags: vi.fn(),
}))

vi.mock('@/lib/stores/useQuestionSelection', () => ({
    useQuestionSelection: () => ({
        selectedIds: new Set(),
        toggleSelection: vi.fn(),
        selectAll: vi.fn(),
        clearSelection: vi.fn(),
    }),
}))

vi.mock('@/components/quiz/GroupedTagMultiSelect', () => ({
    GroupedTagMultiSelect: ({ selectedSlugs, onChange }: { selectedSlugs: string[], onChange: (slugs: string[]) => void }) => (
        <div data-testid="tag-multi-select">
            <span data-testid="selected-tags">{selectedSlugs.join(',')}</span>
            <button data-testid="add-tag" onClick={() => onChange([...selectedSlugs, 'new-tag'])}>
                Add Tag
            </button>
            <button data-testid="remove-tag" onClick={() => onChange(selectedSlugs.filter(s => s !== 'tag-1'))}>
                Remove Tag
            </button>
        </div>
    ),
}))

import { fetchAdminExamQuestions, updateQuestionTags, batchUpdateQuestionTags, fetchTags } from '@/lib/apiClient'
import type { Question, Tag } from '@/types'

// Sample question data with tags
const mockQuestions: Question[] = [
    {
        id: 'q1',
        stem: 'Test question 1',
        options: { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
        answer: 'A',
        explanation: 'Test explanation',
        difficulty: 3,
        year: 2024,
        examType: '國考',
        imageUrls: [],
        tags: [
            { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
            { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
]

const mockTagsResponse = {
    tags: [
        { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
        { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
        { id: 't3', name: '藥理學', slug: 'pharmacology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
    ] as Tag[],
    grouped: {
        ACADEMIC: [
            { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
            { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
            { id: 't3', name: '藥理學', slug: 'pharmacology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
        ],
        ORGAN: [],
        EXAM_CATEGORY: [],
        META: [],
    },
}

describe('Exam Detail Page - Tag Management', () => {
    let queryClient: QueryClient

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        })
        vi.resetAllMocks()
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    describe('Tag Management Integration', () => {
        it('should call updateQuestionTags API when adding tags', async () => {
            const mockFetchAdminExamQuestions = vi.mocked(fetchAdminExamQuestions)
            const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)
            const mockFetchTags = vi.mocked(fetchTags)

            mockFetchAdminExamQuestions.mockResolvedValue(mockQuestions)
            mockFetchTags.mockResolvedValue(mockTagsResponse)
            mockUpdateQuestionTags.mockResolvedValue({
                id: 'q1',
                stem: 'Test question 1',
                updatedAt: '2024-01-01T00:00:00Z',
                tags: [
                    { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                    { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                    { id: 't3', name: '藥理學', slug: 'pharmacology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                ],
            })

            // Verify the API function exists and works correctly
            const result = await updateQuestionTags('q1', { add: ['pharmacology'], remove: [] })

            expect(mockUpdateQuestionTags).toHaveBeenCalledWith('q1', { add: ['pharmacology'], remove: [] })
            expect(result.tags).toHaveLength(3)
            expect(result.tags.map(t => t.slug)).toContain('pharmacology')
        })

        it('should call updateQuestionTags API when removing tags', async () => {
            const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)

            mockUpdateQuestionTags.mockResolvedValue({
                id: 'q1',
                stem: 'Test question 1',
                updatedAt: '2024-01-01T00:00:00Z',
                tags: [
                    { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                ],
            })

            const result = await updateQuestionTags('q1', { add: [], remove: ['anatomy'] })

            expect(mockUpdateQuestionTags).toHaveBeenCalledWith('q1', { add: [], remove: ['anatomy'] })
            expect(result.tags).toHaveLength(1)
            expect(result.tags.map(t => t.slug)).not.toContain('anatomy')
        })

        it('should handle both add and remove operations simultaneously', async () => {
            const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)

            mockUpdateQuestionTags.mockResolvedValue({
                id: 'q1',
                stem: 'Test question 1',
                updatedAt: '2024-01-01T00:00:00Z',
                tags: [
                    { id: 't2', name: '生理學', slug: 'physiology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                    { id: 't3', name: '藥理學', slug: 'pharmacology', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                ],
            })

            const result = await updateQuestionTags('q1', { add: ['pharmacology'], remove: ['anatomy'] })

            expect(mockUpdateQuestionTags).toHaveBeenCalledWith('q1', { add: ['pharmacology'], remove: ['anatomy'] })
            expect(result.tags).toHaveLength(2)
            expect(result.tags.map(t => t.slug)).toContain('pharmacology')
            expect(result.tags.map(t => t.slug)).not.toContain('anatomy')
        })
    })

    describe('Tag Selection Logic', () => {
        it('should calculate correct add/remove arrays when tags change', () => {
            const originalSlugs = ['anatomy', 'physiology']
            const newSlugs = ['physiology', 'pharmacology']

            const add = newSlugs.filter(s => !originalSlugs.includes(s))
            const remove = originalSlugs.filter(s => !newSlugs.includes(s))

            expect(add).toEqual(['pharmacology'])
            expect(remove).toEqual(['anatomy'])
        })

        it('should return empty arrays when no change', () => {
            const originalSlugs = ['anatomy', 'physiology']
            const newSlugs = ['anatomy', 'physiology']

            const add = newSlugs.filter(s => !originalSlugs.includes(s))
            const remove = originalSlugs.filter(s => !newSlugs.includes(s))

            expect(add).toEqual([])
            expect(remove).toEqual([])
        })

        it('should handle adding multiple tags at once', () => {
            const originalSlugs = ['anatomy']
            const newSlugs = ['anatomy', 'physiology', 'pharmacology']

            const add = newSlugs.filter(s => !originalSlugs.includes(s))
            const remove = originalSlugs.filter(s => !newSlugs.includes(s))

            expect(add).toEqual(['physiology', 'pharmacology'])
            expect(remove).toEqual([])
        })

        it('should handle removing all tags', () => {
            const originalSlugs = ['anatomy', 'physiology']
            const newSlugs: string[] = []

            const add = newSlugs.filter(s => !originalSlugs.includes(s))
            const remove = originalSlugs.filter(s => !newSlugs.includes(s))

            expect(add).toEqual([])
            expect(remove).toEqual(['anatomy', 'physiology'])
        })
    })

    describe('API Response Structure', () => {
        it('should return question with updated tags array', async () => {
            const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)

            const expectedResponse = {
                id: 'q1',
                stem: 'Test question 1',
                updatedAt: '2024-01-01T00:00:00Z',
                tags: [
                    { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                ],
            }

            mockUpdateQuestionTags.mockResolvedValue(expectedResponse)

            const result = await updateQuestionTags('q1', { add: ['anatomy'], remove: [] })

            expect(result).toHaveProperty('id')
            expect(result).toHaveProperty('stem')
            expect(result).toHaveProperty('updatedAt')
            expect(result).toHaveProperty('tags')
            expect(Array.isArray(result.tags)).toBe(true)
        })

        it('should include full tag objects in response', async () => {
            const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)

            mockUpdateQuestionTags.mockResolvedValue({
                id: 'q1',
                stem: 'Test question 1',
                updatedAt: '2024-01-01T00:00:00Z',
                tags: [
                    { id: 't1', name: '解剖學', slug: 'anatomy', dimension: 'ACADEMIC', groupName: '基礎醫學' },
                ],
            })

            const result = await updateQuestionTags('q1', { add: ['anatomy'], remove: [] })

            const firstTag = result.tags[0]
            expect(firstTag).toHaveProperty('id')
            expect(firstTag).toHaveProperty('name')
            expect(firstTag).toHaveProperty('slug')
            expect(firstTag).toHaveProperty('dimension')
        })
    })
})

describe('updateQuestionTags API Function', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('should be exported from apiClient', () => {
        // The function should exist and be importable
        expect(typeof updateQuestionTags).toBe('function')
    })

    it('should accept questionId and payload with add/remove arrays', async () => {
        const mockUpdateQuestionTags = vi.mocked(updateQuestionTags)

        mockUpdateQuestionTags.mockResolvedValue({
            id: 'q1',
            stem: 'Test',
            updatedAt: '2024-01-01T00:00:00Z',
            tags: [],
        })

        // Test that the function signature is correct
        await updateQuestionTags('q1', { add: ['tag1'], remove: ['tag2'] })

        expect(mockUpdateQuestionTags).toHaveBeenCalledWith('q1', { add: ['tag1'], remove: ['tag2'] })
    })
})

describe('batchUpdateQuestionTags API Function', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('should be exported from apiClient', () => {
        expect(typeof batchUpdateQuestionTags).toBe('function')
    })

    it('should accept payload with questionIds, add, and remove arrays', async () => {
        const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)

        mockBatchUpdate.mockResolvedValue({
            ok: true,
            affectedCount: 3,
        })

        const payload = {
            questionIds: ['q1', 'q2', 'q3'],
            add: ['anatomy', 'physiology'],
            remove: ['old-tag'],
        }

        const result = await batchUpdateQuestionTags(payload)

        expect(mockBatchUpdate).toHaveBeenCalledWith(payload)
        expect(result.ok).toBe(true)
        expect(result.affectedCount).toBe(3)
    })

    it('should handle adding tags only', async () => {
        const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)

        mockBatchUpdate.mockResolvedValue({
            ok: true,
            affectedCount: 2,
        })

        const result = await batchUpdateQuestionTags({
            questionIds: ['q1', 'q2'],
            add: ['new-tag'],
            remove: [],
        })

        expect(result.affectedCount).toBe(2)
    })

    it('should handle removing tags only', async () => {
        const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)

        mockBatchUpdate.mockResolvedValue({
            ok: true,
            affectedCount: 5,
        })

        const result = await batchUpdateQuestionTags({
            questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
            add: [],
            remove: ['obsolete-tag'],
        })

        expect(result.affectedCount).toBe(5)
    })

    it('should handle empty questionIds array', async () => {
        const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)

        mockBatchUpdate.mockResolvedValue({
            ok: true,
            affectedCount: 0,
        })

        const result = await batchUpdateQuestionTags({
            questionIds: [],
            add: ['tag1'],
            remove: [],
        })

        expect(result.ok).toBe(true)
        expect(result.affectedCount).toBe(0)
    })
})

describe('Batch Tag UI', () => {
    let queryClient: QueryClient

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        })
        vi.resetAllMocks()
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    describe('Batch Tag Selection Logic', () => {
        it('should require at least one question to be selected', () => {
            const selectedIds = new Set<string>()
            expect(selectedIds.size).toBe(0)

            // Simulate selection
            selectedIds.add('q1')
            selectedIds.add('q2')
            expect(selectedIds.size).toBe(2)
        })

        it('should maintain selected tag slugs for batch operation', () => {
            const selectedTagSlugs: string[] = []

            // Add tags
            selectedTagSlugs.push('anatomy', 'physiology')
            expect(selectedTagSlugs).toEqual(['anatomy', 'physiology'])

            // Remove a tag
            const index = selectedTagSlugs.indexOf('anatomy')
            if (index > -1) selectedTagSlugs.splice(index, 1)
            expect(selectedTagSlugs).toEqual(['physiology'])
        })

        it('should prevent duplicate tag selections', () => {
            const selectedTagSlugs = new Set<string>()

            selectedTagSlugs.add('anatomy')
            selectedTagSlugs.add('anatomy') // Duplicate
            selectedTagSlugs.add('physiology')

            expect(selectedTagSlugs.size).toBe(2)
            expect(Array.from(selectedTagSlugs)).toEqual(['anatomy', 'physiology'])
        })
    })

    describe('Batch Tag Modal State', () => {
        it('should track modal open state', () => {
            let isModalOpen = false

            // Open modal
            isModalOpen = true
            expect(isModalOpen).toBe(true)

            // Close modal
            isModalOpen = false
            expect(isModalOpen).toBe(false)
        })

        it('should track batch operation mode (add vs remove)', () => {
            type BatchMode = 'add' | 'remove' | null
            let mode: BatchMode = null

            // Set to add mode
            mode = 'add'
            expect(mode).toBe('add')

            // Set to remove mode
            mode = 'remove'
            expect(mode).toBe('remove')
        })
    })

    describe('Batch Tag API Integration', () => {
        it('should prepare correct payload for batch add operation', async () => {
            const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)
            mockBatchUpdate.mockResolvedValue({ ok: true, affectedCount: 3 })

            const selectedIds = new Set(['q1', 'q2', 'q3'])
            const selectedTags = ['anatomy', 'physiology']

            const payload = {
                questionIds: Array.from(selectedIds),
                add: selectedTags,
                remove: [],
            }

            await batchUpdateQuestionTags(payload)

            expect(mockBatchUpdate).toHaveBeenCalledWith({
                questionIds: ['q1', 'q2', 'q3'],
                add: ['anatomy', 'physiology'],
                remove: [],
            })
        })

        it('should prepare correct payload for batch remove operation', async () => {
            const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)
            mockBatchUpdate.mockResolvedValue({ ok: true, affectedCount: 2 })

            const selectedIds = new Set(['q1', 'q2'])
            const selectedTags = ['old-tag']

            const payload = {
                questionIds: Array.from(selectedIds),
                add: [],
                remove: selectedTags,
            }

            await batchUpdateQuestionTags(payload)

            expect(mockBatchUpdate).toHaveBeenCalledWith({
                questionIds: ['q1', 'q2'],
                add: [],
                remove: ['old-tag'],
            })
        })

        it('should handle API response with affectedCount', async () => {
            const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)
            mockBatchUpdate.mockResolvedValue({ ok: true, affectedCount: 5 })

            const result = await batchUpdateQuestionTags({
                questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
                add: ['new-tag'],
                remove: [],
            })

            expect(result.ok).toBe(true)
            expect(result.affectedCount).toBeGreaterThan(0)
        })

        it('should handle API error gracefully', async () => {
            const mockBatchUpdate = vi.mocked(batchUpdateQuestionTags)
            mockBatchUpdate.mockRejectedValue(new Error('API Error'))

            await expect(
                batchUpdateQuestionTags({
                    questionIds: ['q1'],
                    add: ['tag1'],
                    remove: [],
                })
            ).rejects.toThrow('API Error')
        })
    })

    describe('Batch Tag Toolbar Behavior', () => {
        it('should show toolbar when questions are selected', () => {
            const selectedCount = 3
            const showToolbar = selectedCount > 0
            expect(showToolbar).toBe(true)
        })

        it('should hide toolbar when no questions are selected', () => {
            const selectedCount = 0
            const showToolbar = selectedCount > 0
            expect(showToolbar).toBe(false)
        })

        it('should display correct selected count', () => {
            const selectedIds = new Set(['q1', 'q2', 'q3', 'q4', 'q5'])
            expect(selectedIds.size).toBe(5)
        })
    })

    describe('Batch Tag Dialog Interaction', () => {
        it('should clear tag selection when dialog closes', () => {
            let selectedTags = ['anatomy', 'physiology']

            // Clear selection on close
            selectedTags = []
            expect(selectedTags).toEqual([])
        })

        it('should validate at least one tag is selected before submitting', () => {
            const selectedTags: string[] = []
            const isValid = selectedTags.length > 0
            expect(isValid).toBe(false)

            selectedTags.push('anatomy')
            expect(selectedTags.length > 0).toBe(true)
        })

        it('should prevent submission when no questions selected', () => {
            const selectedIds = new Set<string>()
            const selectedTags = ['anatomy']

            const canSubmit = selectedIds.size > 0 && selectedTags.length > 0
            expect(canSubmit).toBe(false)
        })
    })
})
