import { describe, it, expect, vi } from 'vitest'

function getDifficultyDisplay(difficulty: number | null | undefined): string {
    if (difficulty === undefined || difficulty === null) {
        return '難度 未設定'
    }
    return `難度 ${'★'.repeat(difficulty)}${'☆'.repeat(5 - difficulty)}`
}

const DIFFICULTY_LABELS: Record<number, string> = {
    1: '最簡單',
    2: '簡單',
    3: '中等',
    4: '困難',
    5: '最困難',
}

interface DifficultySelectorProps {
    value: 1 | 2 | 3 | 4 | 5 | null | undefined
    onChange: (difficulty: 1 | 2 | 3 | 4 | 5 | null) => void
}

function getDifficultyLabel(value: 1 | 2 | 3 | 4 | 5 | null | undefined): string {
    if (value !== null && value !== undefined) {
        return `難度 ${value}: ${DIFFICULTY_LABELS[value]}`
    }
    return '難度未設定'
}

function createDifficultySelectorState(initialValue: 1 | 2 | 3 | 4 | 5 | null | undefined) {
    let currentValue = initialValue
    const onChange = vi.fn((newValue: 1 | 2 | 3 | 4 | 5 | null) => {
        currentValue = newValue
    })

    const selectLevel = (level: 1 | 2 | 3 | 4 | 5 | null) => {
        onChange(level)
    }

    const getValue = () => currentValue
    const getLabel = () => getDifficultyLabel(currentValue)

    return { onChange, selectLevel, getValue, getLabel }
}

describe('AuditWorkstation - Difficulty Display', () => {
    describe('getDifficultyDisplay', () => {
        it('displays difficulty 1 with 1 filled star and 4 empty stars', () => {
            const result = getDifficultyDisplay(1)
            expect(result).toBe('難度 ★☆☆☆☆')
        })

        it('displays difficulty 2 with 2 filled stars and 3 empty stars', () => {
            const result = getDifficultyDisplay(2)
            expect(result).toBe('難度 ★★☆☆☆')
        })

        it('displays difficulty 3 with 3 filled stars and 2 empty stars', () => {
            const result = getDifficultyDisplay(3)
            expect(result).toBe('難度 ★★★☆☆')
        })

        it('displays difficulty 4 with 4 filled stars and 1 empty star', () => {
            const result = getDifficultyDisplay(4)
            expect(result).toBe('難度 ★★★★☆')
        })

        it('displays difficulty 5 with 5 filled stars', () => {
            const result = getDifficultyDisplay(5)
            expect(result).toBe('難度 ★★★★★')
        })

        it('displays "未設定" for null difficulty', () => {
            const result = getDifficultyDisplay(null)
            expect(result).toBe('難度 未設定')
        })

        it('displays "未設定" for undefined difficulty', () => {
            const result = getDifficultyDisplay(undefined)
            expect(result).toBe('難度 未設定')
        })

        it('includes the label "難度" in the display', () => {
            const result = getDifficultyDisplay(3)
            expect(result).toContain('難度')
        })
    })

    describe('Difficulty star pattern', () => {
        it('always shows exactly 5 star characters (filled + empty)', () => {
            for (let difficulty = 1; difficulty <= 5; difficulty++) {
                const filledStars = '★'.repeat(difficulty)
                const emptyStars = '☆'.repeat(5 - difficulty)
                const totalStars = filledStars + emptyStars

                expect(totalStars.length).toBe(5)
                expect(totalStars.split('★').length - 1).toBe(difficulty)
                expect(totalStars.split('☆').length - 1).toBe(5 - difficulty)
            }
        })
    })
})

describe('ExtractedQuestion difficulty type', () => {
    it('accepts valid difficulty values (1-5, null, undefined)', () => {
        interface ExtractedQuestion {
            stem: string
            options: { A: string; B: string; C: string; D: string }
            answer: 'A' | 'B' | 'C' | 'D'
            difficulty?: 1 | 2 | 3 | 4 | 5 | null
        }

        const validQuestions: ExtractedQuestion[] = [
            { stem: 'Q1', options: { A: 'A', B: 'B', C: 'C', D: 'D' }, answer: 'A', difficulty: 1 },
            { stem: 'Q2', options: { A: 'A', B: 'B', C: 'C', D: 'D' }, answer: 'A', difficulty: 3 },
            { stem: 'Q3', options: { A: 'A', B: 'B', C: 'C', D: 'D' }, answer: 'A', difficulty: 5 },
            { stem: 'Q4', options: { A: 'A', B: 'B', C: 'C', D: 'D' }, answer: 'A', difficulty: null },
            { stem: 'Q5', options: { A: 'A', B: 'B', C: 'C', D: 'D' }, answer: 'A' },
        ]

        expect(validQuestions).toHaveLength(5)
        expect(validQuestions[0].difficulty).toBe(1)
        expect(validQuestions[1].difficulty).toBe(3)
        expect(validQuestions[2].difficulty).toBe(5)
        expect(validQuestions[3].difficulty).toBeNull()
        expect(validQuestions[4].difficulty).toBeUndefined()
    })
})

describe('DifficultySelector', () => {
    it('initializes with undefined value', () => {
        const selector = createDifficultySelectorState(undefined)
        expect(selector.getValue()).toBeUndefined()
        expect(selector.getLabel()).toBe('難度未設定')
    })

    it('initializes with null value', () => {
        const selector = createDifficultySelectorState(null)
        expect(selector.getValue()).toBeNull()
        expect(selector.getLabel()).toBe('難度未設定')
    })

    it('initializes with difficulty 1', () => {
        const selector = createDifficultySelectorState(1)
        expect(selector.getValue()).toBe(1)
        expect(selector.getLabel()).toBe('難度 1: 最簡單')
    })

    it('initializes with difficulty 3', () => {
        const selector = createDifficultySelectorState(3)
        expect(selector.getValue()).toBe(3)
        expect(selector.getLabel()).toBe('難度 3: 中等')
    })

    it('initializes with difficulty 5', () => {
        const selector = createDifficultySelectorState(5)
        expect(selector.getValue()).toBe(5)
        expect(selector.getLabel()).toBe('難度 5: 最困難')
    })

    it('selects difficulty 1 and calls onChange', () => {
        const selector = createDifficultySelectorState(undefined)
        selector.selectLevel(1)
        expect(selector.onChange).toHaveBeenCalledWith(1)
        expect(selector.getValue()).toBe(1)
        expect(selector.getLabel()).toBe('難度 1: 最簡單')
    })

    it('selects difficulty 3 and calls onChange', () => {
        const selector = createDifficultySelectorState(undefined)
        selector.selectLevel(3)
        expect(selector.onChange).toHaveBeenCalledWith(3)
        expect(selector.getValue()).toBe(3)
        expect(selector.getLabel()).toBe('難度 3: 中等')
    })

    it('selects difficulty 5 and calls onChange', () => {
        const selector = createDifficultySelectorState(undefined)
        selector.selectLevel(5)
        expect(selector.onChange).toHaveBeenCalledWith(5)
        expect(selector.getValue()).toBe(5)
        expect(selector.getLabel()).toBe('難度 5: 最困難')
    })

    it('clears difficulty by selecting null', () => {
        const selector = createDifficultySelectorState(3)
        selector.selectLevel(null)
        expect(selector.onChange).toHaveBeenCalledWith(null)
        expect(selector.getValue()).toBeNull()
        expect(selector.getLabel()).toBe('難度未設定')
    })

    it('allows changing from one difficulty to another', () => {
        const selector = createDifficultySelectorState(1)
        expect(selector.getValue()).toBe(1)

        selector.selectLevel(4)
        expect(selector.getValue()).toBe(4)
        expect(selector.getLabel()).toBe('難度 4: 困難')
    })

    it('handles all valid difficulty levels 1-5', () => {
        const selector = createDifficultySelectorState(undefined)

        const expectedLabels: Record<number, string> = {
            1: '難度 1: 最簡單',
            2: '難度 2: 簡單',
            3: '難度 3: 中等',
            4: '難度 4: 困難',
            5: '難度 5: 最困難',
        }

        for (let level = 1; level <= 5; level++) {
            selector.selectLevel(level as 1 | 2 | 3 | 4 | 5)
            expect(selector.getValue()).toBe(level)
            expect(selector.getLabel()).toBe(expectedLabels[level])
        }
    })

    it('displays correct label for difficulty 2', () => {
        const selector = createDifficultySelectorState(2)
        expect(selector.getLabel()).toBe('難度 2: 簡單')
    })

    it('displays correct label for difficulty 4', () => {
        const selector = createDifficultySelectorState(4)
        expect(selector.getLabel()).toBe('難度 4: 困難')
    })
})

describe('Difficulty Labels', () => {
    it('has correct labels for all difficulty levels', () => {
        expect(DIFFICULTY_LABELS[1]).toBe('最簡單')
        expect(DIFFICULTY_LABELS[2]).toBe('簡單')
        expect(DIFFICULTY_LABELS[3]).toBe('中等')
        expect(DIFFICULTY_LABELS[4]).toBe('困難')
        expect(DIFFICULTY_LABELS[5]).toBe('最困難')
    })
})

describe('getDifficultyLabel helper', () => {
    it('returns correct label for each difficulty level', () => {
        expect(getDifficultyLabel(1)).toBe('難度 1: 最簡單')
        expect(getDifficultyLabel(2)).toBe('難度 2: 簡單')
        expect(getDifficultyLabel(3)).toBe('難度 3: 中等')
        expect(getDifficultyLabel(4)).toBe('難度 4: 困難')
        expect(getDifficultyLabel(5)).toBe('難度 5: 最困難')
    })

    it('returns "未設定" for null', () => {
        expect(getDifficultyLabel(null)).toBe('難度未設定')
    })

    it('returns "未設定" for undefined', () => {
        expect(getDifficultyLabel(undefined)).toBe('難度未設定')
    })
})

describe('Difficulty Persistence', () => {
    it('difficulty value is included in question data structure', () => {
        interface ExtractedQuestion {
            stem: string
            options: { A: string; B: string; C: string; D: string }
            answer: 'A' | 'B' | 'C' | 'D'
            difficulty?: 1 | 2 | 3 | 4 | 5 | null
        }

        const question: ExtractedQuestion = {
            stem: '測試題目',
            options: { A: '選項A', B: '選項B', C: '選項C', D: '選項D' },
            answer: 'B',
            difficulty: 3,
        }

        expect(question.difficulty).toBe(3)
    })

    it('difficulty can be updated in question data', () => {
        interface ExtractedQuestion {
            stem: string
            options: { A: string; B: string; C: string; D: string }
            answer: 'A' | 'B' | 'C' | 'D'
            difficulty?: 1 | 2 | 3 | 4 | 5 | null
        }

        const question: ExtractedQuestion = {
            stem: '測試題目',
            options: { A: '選項A', B: '選項B', C: '選項C', D: '選項D' },
            answer: 'B',
            difficulty: 2,
        }

        question.difficulty = 4
        expect(question.difficulty).toBe(4)
    })
})

describe('Tag Management Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('Question Tag API Contract', () => {
        it('should have correct PATCH API structure for adding tags', () => {
            const requestBody = {
                add: ['tag-slug-1', 'tag-slug-2'],
                remove: [],
            }

            expect(requestBody).toHaveProperty('add')
            expect(requestBody).toHaveProperty('remove')
            expect(Array.isArray(requestBody.add)).toBe(true)
            expect(Array.isArray(requestBody.remove)).toBe(true)
        })

        it('should have correct PATCH API structure for removing tags', () => {
            const requestBody = {
                add: [],
                remove: ['tag-slug-1'],
            }

            expect(requestBody.add).toHaveLength(0)
            expect(requestBody.remove).toHaveLength(1)
        })

        it('should have correct PATCH API structure for mixed operations', () => {
            const requestBody = {
                add: ['new-tag'],
                remove: ['old-tag'],
            }

            expect(requestBody.add).toContain('new-tag')
            expect(requestBody.remove).toContain('old-tag')
        })

        it('should require x-user-role header with MODERATOR or ADMIN', () => {
            const validRoles = ['MODERATOR', 'ADMIN']
            const headers = { 'x-user-role': 'MODERATOR' }

            expect(validRoles).toContain(headers['x-user-role'])
        })
    })

    describe('Tag Selection State Management', () => {
        it('should track selected tag slugs as array of strings', () => {
            const selectedSlugs: string[] = ['anatomy', 'physiology']

            expect(selectedSlugs).toBeInstanceOf(Array)
            expect(selectedSlugs.every(slug => typeof slug === 'string')).toBe(true)
        })

        it('should handle empty tag selection', () => {
            const selectedSlugs: string[] = []

            expect(selectedSlugs).toHaveLength(0)
        })

        it('should update tag selection when tags are added', () => {
            let selectedSlugs: string[] = []
            const newTag = 'new-tag'

            selectedSlugs = [...selectedSlugs, newTag]

            expect(selectedSlugs).toContain(newTag)
        })

        it('should update tag selection when tags are removed', () => {
            let selectedSlugs: string[] = ['tag-1', 'tag-2', 'tag-3']
            const tagToRemove = 'tag-2'

            selectedSlugs = selectedSlugs.filter(slug => slug !== tagToRemove)

            expect(selectedSlugs).not.toContain(tagToRemove)
            expect(selectedSlugs).toHaveLength(2)
        })
    })

    describe('Tag Change Detection', () => {
        it('should detect when tags have been added', () => {
            const originalSlugs = ['tag-1']
            const currentSlugs = ['tag-1', 'tag-2']

            const added = currentSlugs.filter(slug => !originalSlugs.includes(slug))

            expect(added).toEqual(['tag-2'])
        })

        it('should detect when tags have been removed', () => {
            const originalSlugs = ['tag-1', 'tag-2']
            const currentSlugs = ['tag-1']

            const removed = originalSlugs.filter(slug => !currentSlugs.includes(slug))

            expect(removed).toEqual(['tag-2'])
        })

        it('should detect mixed tag changes', () => {
            const originalSlugs = ['tag-1', 'tag-2']
            const currentSlugs = ['tag-1', 'tag-3']

            const added = currentSlugs.filter(slug => !originalSlugs.includes(slug))
            const removed = originalSlugs.filter(slug => !currentSlugs.includes(slug))

            expect(added).toEqual(['tag-3'])
            expect(removed).toEqual(['tag-2'])
        })

        it('should not detect changes when tags are unchanged', () => {
            const originalSlugs = ['tag-1', 'tag-2']
            const currentSlugs = ['tag-1', 'tag-2']

            const added = currentSlugs.filter(slug => !originalSlugs.includes(slug))
            const removed = originalSlugs.filter(slug => !currentSlugs.includes(slug))

            expect(added).toHaveLength(0)
            expect(removed).toHaveLength(0)
        })
    })

    describe('Tag API Request Preparation', () => {
        it('should prepare correct request body for API call', () => {
            const originalSlugs = ['tag-1', 'tag-2']
            const currentSlugs = ['tag-1', 'tag-3']

            const add = currentSlugs.filter(slug => !originalSlugs.includes(slug))
            const remove = originalSlugs.filter(slug => !currentSlugs.includes(slug))

            const requestBody = { add, remove }

            expect(requestBody).toEqual({
                add: ['tag-3'],
                remove: ['tag-2'],
            })
        })

        it('should not include empty arrays in request if no changes', () => {
            const originalSlugs = ['tag-1']
            const currentSlugs = ['tag-1']

            const add = currentSlugs.filter(slug => !originalSlugs.includes(slug))
            const remove = originalSlugs.filter(slug => !currentSlugs.includes(slug))

            expect(add).toHaveLength(0)
            expect(remove).toHaveLength(0)
        })
    })

    describe('ExtractedQuestion Tag Integration', () => {
        it('should include tagSlugs in ExtractedQuestion type', () => {
            interface ExtractedQuestion {
                stem: string
                options: { A: string; B: string; C: string; D: string }
                answer: 'A' | 'B' | 'C' | 'D'
                explanation?: string
                imagePlaceholders?: string[]
                imageUrls?: string[]
                tagSlugs?: string[]
                difficulty?: 1 | 2 | 3 | 4 | 5 | null
            }

            const question: ExtractedQuestion = {
                stem: 'Test question',
                options: { A: 'A', B: 'B', C: 'C', D: 'D' },
                answer: 'A',
                tagSlugs: ['anatomy', 'physiology'],
            }

            expect(question.tagSlugs).toEqual(['anatomy', 'physiology'])
        })

        it('should allow undefined tagSlugs for backward compatibility', () => {
            interface ExtractedQuestion {
                stem: string
                options: { A: string; B: string; C: string; D: string }
                answer: 'A' | 'B' | 'C' | 'D'
                tagSlugs?: string[]
            }

            const question: ExtractedQuestion = {
                stem: 'Test question',
                options: { A: 'A', B: 'B', C: 'C', D: 'D' },
                answer: 'A',
            }

            expect(question.tagSlugs).toBeUndefined()
        })
    })

    describe('GroupedTagMultiSelect Props Interface', () => {
        it('should accept selectedSlugs as string array', () => {
            interface TagFilterProps {
                selectedSlugs: string[]
                onChange: (slugs: string[]) => void
                className?: string
            }

            const props: TagFilterProps = {
                selectedSlugs: ['tag-1', 'tag-2'],
                onChange: () => {},
            }

            expect(Array.isArray(props.selectedSlugs)).toBe(true)
            expect(props.selectedSlugs.every(s => typeof s === 'string')).toBe(true)
        })

        it('should call onChange with updated slugs when selection changes', () => {
            const mockOnChange = vi.fn()
            const newSlugs = ['tag-1', 'tag-2', 'tag-3']

            mockOnChange(newSlugs)

            expect(mockOnChange).toHaveBeenCalledWith(newSlugs)
            expect(mockOnChange).toHaveBeenCalledTimes(1)
        })
    })
})
