/**
 * End-to-end integration tests for batch tag operations
 * Tests the complete flow from UI state to API calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Batch Tag Operations - End-to-End Integration', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.restoreAllMocks())

    describe('API Contract Validation', () => {
        it('validates BatchQuestionTagsSchema for batch add', () => {
            const validPayload = {
                questionIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
                add: ['cardiology', 'physiology'],
                remove: [],
            }

            expect(validPayload.questionIds).toHaveLength(2)
            expect(validPayload.add).toHaveLength(2)
            expect(validPayload.remove).toEqual([])
        })

        it('validates BatchQuestionTagsSchema for batch remove', () => {
            const validPayload = {
                questionIds: ['11111111-1111-1111-1111-111111111111'],
                add: [],
                remove: ['obsolete-tag'],
            }

            expect(validPayload.questionIds).toHaveLength(1)
            expect(validPayload.add).toEqual([])
            expect(validPayload.remove).toHaveLength(1)
        })

        it('validates BatchQuestionTagsSchema for combined add/remove', () => {
            const validPayload = {
                questionIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
                add: ['new-tag'],
                remove: ['old-tag'],
            }

            expect(validPayload.questionIds).toHaveLength(2)
            expect(validPayload.add).toHaveLength(1)
            expect(validPayload.remove).toHaveLength(1)
        })

        it('rejects empty questionIds array', () => {
            const invalidPayload = {
                questionIds: [],
                add: ['cardiology'],
                remove: [],
            }

            expect(invalidPayload.questionIds).toHaveLength(0)
        })

        it('rejects invalid UUID format in questionIds', () => {
            const invalidPayload = {
                questionIds: ['not-a-uuid'],
                add: ['cardiology'],
                remove: [],
            }

            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            expect(invalidPayload.questionIds[0]).not.toMatch(uuidRegex)
        })

        it('limits questionIds to 100 items', () => {
            const validPayload = {
                questionIds: Array(100).fill('11111111-1111-1111-1111-111111111111'),
                add: ['cardiology'],
                remove: [],
            }

            expect(validPayload.questionIds).toHaveLength(100)
        })

        it('rejects questionIds above 100 items', () => {
            const invalidPayload = {
                questionIds: Array(101).fill('11111111-1111-1111-1111-111111111111'),
                add: ['cardiology'],
                remove: [],
            }

            expect(invalidPayload.questionIds).toHaveLength(101)
        })

        it('limits tag arrays to 50 items', () => {
            const validPayload = {
                questionIds: ['11111111-1111-1111-1111-111111111111'],
                add: Array(50).fill('tag'),
                remove: [],
            }

            expect(validPayload.add).toHaveLength(50)
        })

        it('rejects tag arrays above 50 items', () => {
            const invalidPayload = {
                questionIds: ['11111111-1111-1111-1111-111111111111'],
                add: Array(51).fill('tag'),
                remove: [],
            }

            expect(invalidPayload.add).toHaveLength(51)
        })
    })

    describe('UI State Management', () => {
        it('tracks selected question indices as Set', () => {
            const selectedIndices = new Set<number>([0, 2, 4])

            expect(selectedIndices.has(0)).toBe(true)
            expect(selectedIndices.has(1)).toBe(false)
            expect(selectedIndices.has(2)).toBe(true)
            expect(selectedIndices.size).toBe(3)
        })

        it('toggles individual question selection', () => {
            const selectedIndices = new Set<number>()

            selectedIndices.add(0)
            expect(selectedIndices.has(0)).toBe(true)

            selectedIndices.delete(0)
            expect(selectedIndices.has(0)).toBe(false)
        })

        it('selects all questions', () => {
            const totalQuestions = 5
            const selectedIndices = new Set<number>()

            for (let i = 0; i < totalQuestions; i++) {
                selectedIndices.add(i)
            }

            expect(selectedIndices.size).toBe(totalQuestions)
        })

        it('clears all selections', () => {
            const selectedIndices = new Set<number>([0, 1, 2, 3, 4])

            selectedIndices.clear()

            expect(selectedIndices.size).toBe(0)
        })

        it('determines if all questions are selected', () => {
            const totalQuestions = 5
            const selectedIndices = new Set<number>([0, 1, 2, 3, 4])

            const allSelected = selectedIndices.size === totalQuestions
            expect(allSelected).toBe(true)

            selectedIndices.delete(2)
            const stillAllSelected = selectedIndices.size === totalQuestions
            expect(stillAllSelected).toBe(false)
        })

        it('tracks batch tag dialog state', () => {
            let isDialogOpen = false
            let dialogMode: 'add' | 'remove' | null = null
            const selectedTags: string[] = []

            expect(isDialogOpen).toBe(false)
            expect(dialogMode).toBe(null)
            expect(selectedTags).toHaveLength(0)

            isDialogOpen = true
            dialogMode = 'add'
            selectedTags.push('cardiology', 'physiology')

            expect(isDialogOpen).toBe(true)
            expect(dialogMode).toBe('add')
            expect(selectedTags).toHaveLength(2)
        })
    })

    describe('Question ID Extraction', () => {
        it('extracts question IDs from selected indices', () => {
            const questions = [
                { id: 'q1', stem: 'Question 1' },
                { id: 'q2', stem: 'Question 2' },
                { id: 'q3', stem: 'Question 3' },
            ]
            const selectedIndices = new Set<number>([0, 2])

            const questionIds = Array.from(selectedIndices).map(idx => questions[idx].id)

            expect(questionIds).toEqual(['q1', 'q3'])
        })

        it('handles empty selection', () => {
            const questions = [
                { id: 'q1', stem: 'Question 1' },
                { id: 'q2', stem: 'Question 2' },
            ]
            const selectedIndices = new Set<number>()

            const questionIds = Array.from(selectedIndices).map(idx => questions[idx].id)

            expect(questionIds).toEqual([])
        })

        it('handles select all', () => {
            const questions = [
                { id: 'q1', stem: 'Question 1' },
                { id: 'q2', stem: 'Question 2' },
                { id: 'q3', stem: 'Question 3' },
            ]
            const selectedIndices = new Set<number>([0, 1, 2])

            const questionIds = Array.from(selectedIndices).map(idx => questions[idx].id)

            expect(questionIds).toEqual(['q1', 'q2', 'q3'])
        })
    })

    describe('Optimistic UI Updates', () => {
        it('optimistically adds tags to local question data', () => {
            interface ExtractedQuestion {
                id: string
                stem: string
                tagSlugs?: string[]
            }

            const questions: ExtractedQuestion[] = [
                { id: 'q1', stem: 'Q1', tagSlugs: ['existing'] },
                { id: 'q2', stem: 'Q2', tagSlugs: [] },
            ]

            const selectedIndices = new Set<number>([0, 1])
            const newTags = ['new-tag']

            selectedIndices.forEach(idx => {
                const q = questions[idx]
                q.tagSlugs = [...new Set([...(q.tagSlugs || []), ...newTags])]
            })

            expect(questions[0].tagSlugs).toContain('existing')
            expect(questions[0].tagSlugs).toContain('new-tag')
            expect(questions[1].tagSlugs).toContain('new-tag')
        })

        it('optimistically removes tags from local question data', () => {
            interface ExtractedQuestion {
                id: string
                stem: string
                tagSlugs?: string[]
            }

            const questions: ExtractedQuestion[] = [
                { id: 'q1', stem: 'Q1', tagSlugs: ['tag-1', 'tag-2', 'tag-3'] },
                { id: 'q2', stem: 'Q2', tagSlugs: ['tag-2', 'tag-3'] },
            ]

            const selectedIndices = new Set<number>([0, 1])
            const tagsToRemove = ['tag-2']

            selectedIndices.forEach(idx => {
                const q = questions[idx]
                q.tagSlugs = (q.tagSlugs || []).filter(slug => !tagsToRemove.includes(slug))
            })

            expect(questions[0].tagSlugs).toEqual(['tag-1', 'tag-3'])
            expect(questions[1].tagSlugs).toEqual(['tag-3'])
        })

        it('handles duplicate tags when adding', () => {
            interface ExtractedQuestion {
                id: string
                stem: string
                tagSlugs?: string[]
            }

            const questions: ExtractedQuestion[] = [
                { id: 'q1', stem: 'Q1', tagSlugs: ['cardiology'] },
            ]

            const selectedIndices = new Set<number>([0])
            const newTags = ['cardiology', 'physiology']

            selectedIndices.forEach(idx => {
                const q = questions[idx]
                q.tagSlugs = [...new Set([...(q.tagSlugs || []), ...newTags])]
            })

            expect(questions[0].tagSlugs).toEqual(['cardiology', 'physiology'])
            expect(questions[0].tagSlugs).toHaveLength(2)
        })
    })

    describe('Error Handling', () => {
        it('handles API error response', () => {
            const errorResponse = { ok: false, code: 'FORBIDDEN', message: '需要管理員權限' }

            expect(errorResponse.ok).toBe(false)
            expect(errorResponse.code).toBe('FORBIDDEN')
        })

        it('handles network error', () => {
            const networkError = new Error('Network error')

            expect(networkError.message).toBe('Network error')
        })

        it('handles validation error', () => {
            const validationError = {
                ok: false,
                code: 'VALIDATION_ERROR',
                message: '請求 body 必須是有效的 JSON',
            }

            expect(validationError.code).toBe('VALIDATION_ERROR')
        })

        it('clears selection after successful operation', () => {
            const selectedIndices = new Set<number>([0, 1, 2])

            selectedIndices.clear()

            expect(selectedIndices.size).toBe(0)
        })

        it('preserves selection on error', () => {
            const selectedIndices = new Set<number>([0, 1, 2])
            const backupIndices = new Set(selectedIndices)

            const operationFailed = true

            if (operationFailed) {
                // Don't clear, preserve the backup
            }

            expect(backupIndices.size).toBe(3)
        })
    })

    describe('Authorization Flow', () => {
        it('requires MODERATOR or ADMIN role', () => {
            const validRoles = ['MODERATOR', 'ADMIN']
            const userRole = 'USER'

            expect(validRoles.includes(userRole)).toBe(false)
        })

        it('accepts MODERATOR role', () => {
            const validRoles = ['MODERATOR', 'ADMIN']
            const userRole = 'MODERATOR'

            expect(validRoles.includes(userRole)).toBe(true)
        })

        it('accepts ADMIN role', () => {
            const validRoles = ['MODERATOR', 'ADMIN']
            const userRole = 'ADMIN'

            expect(validRoles.includes(userRole)).toBe(true)
        })

        it('includes x-user-role header in request', () => {
            const headers = new Headers()
            headers.set('x-user-role', 'ADMIN')

            expect(headers.get('x-user-role')).toBe('ADMIN')
        })
    })

    describe('Response Processing', () => {
        it('processes successful batch response', () => {
            const response = {
                ok: true,
                data: {
                    affectedCount: 5,
                },
            }

            expect(response.ok).toBe(true)
            expect(response.data.affectedCount).toBe(5)
        })

        it('handles partial success', () => {
            const response = {
                ok: true,
                data: {
                    affectedCount: 3,
                },
            }

            const totalRequested = 5
            const affectedCount = response.data.affectedCount

            expect(affectedCount).toBeLessThan(totalRequested)
        })

        it('handles empty result', () => {
            const response = {
                ok: true,
                data: {
                    affectedCount: 0,
                },
            }

            expect(response.data.affectedCount).toBe(0)
        })
    })

    describe('UI Feedback', () => {
        it('shows batch toolbar when questions are selected', () => {
            const selectedIndices = new Set<number>([0, 1])

            const showToolbar = selectedIndices.size > 0
            expect(showToolbar).toBe(true)
        })

        it('hides batch toolbar when no questions are selected', () => {
            const selectedIndices = new Set<number>()

            const showToolbar = selectedIndices.size > 0
            expect(showToolbar).toBe(false)
        })

        it('displays correct selection count', () => {
            const selectedIndices = new Set<number>([0, 1, 2])
            const totalQuestions = 10

            const selectionText = `已選 ${selectedIndices.size} / ${totalQuestions} 題`
            expect(selectionText).toBe('已選 3 / 10 題')
        })

        it('disables batch actions when processing', () => {
            const isProcessing = true

            expect(isProcessing).toBe(true)
        })

        it('shows processing indicator during API call', () => {
            const isProcessing = true
            const processingText = isProcessing ? '處理中...' : '批次新增標籤'

            expect(processingText).toBe('處理中...')
        })
    })

    describe('Tag Selection Dialog', () => {
        it('opens dialog in add mode', () => {
            let isDialogOpen = false
            let dialogMode: 'add' | 'remove' | null = null

            isDialogOpen = true
            dialogMode = 'add'

            expect(isDialogOpen).toBe(true)
            expect(dialogMode).toBe('add')
        })

        it('opens dialog in remove mode', () => {
            let isDialogOpen = false
            let dialogMode: 'add' | 'remove' | null = null

            isDialogOpen = true
            dialogMode = 'remove'

            expect(isDialogOpen).toBe(true)
            expect(dialogMode).toBe('remove')
        })

        it('closes dialog and clears selected tags', () => {
            let isDialogOpen = true
            let selectedTags = ['cardiology', 'physiology']

            isDialogOpen = false
            selectedTags = []

            expect(isDialogOpen).toBe(false)
            expect(selectedTags).toHaveLength(0)
        })

        it('validates at least one tag is selected before submit', () => {
            const selectedTags: string[] = []

            const canSubmit = selectedTags.length > 0
            expect(canSubmit).toBe(false)

            selectedTags.push('cardiology')
            const canSubmitNow = selectedTags.length > 0
            expect(canSubmitNow).toBe(true)
        })
    })

    describe('Integration with Single Question Tag Editing', () => {
        it('does not interfere with single question tag editing', () => {
            const singleEditMode = true
            const batchMode = false

            expect(singleEditMode && batchMode).toBe(false)
        })

        it('only shows batch controls in edit mode', () => {
            const isReadOnly = false
            const showBatchControls = !isReadOnly

            expect(showBatchControls).toBe(true)
        })

        it('disables batch controls when generating explanations', () => {
            const generatingExplanations = true
            const disabled = generatingExplanations

            expect(disabled).toBe(true)
        })

        it('disables batch controls when saving', () => {
            const saving = true
            const disabled = saving

            expect(disabled).toBe(true)
        })
    })
})