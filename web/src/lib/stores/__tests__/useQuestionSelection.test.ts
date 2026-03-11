import { describe, it, expect, beforeEach } from 'vitest'
import { useQuestionSelection } from '../useQuestionSelection'

// ---------------------------------------------------------------------------
// Setup — reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
    useQuestionSelection.setState({ selectedIds: new Set() })
})

// ---------------------------------------------------------------------------
// toggleSelection
// ---------------------------------------------------------------------------

describe('toggleSelection', () => {
    it('adds an id when not selected', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        expect(useQuestionSelection.getState().selectedIds.has('q-1')).toBe(true)
    })

    it('removes an id when already selected', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        useQuestionSelection.getState().toggleSelection('q-1')
        expect(useQuestionSelection.getState().selectedIds.has('q-1')).toBe(false)
    })

    it('does not affect other selections', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        useQuestionSelection.getState().toggleSelection('q-2')
        useQuestionSelection.getState().toggleSelection('q-1') // remove q-1

        expect(useQuestionSelection.getState().selectedIds.has('q-2')).toBe(true)
        expect(useQuestionSelection.getState().selectedIds.size).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// selectAll
// ---------------------------------------------------------------------------

describe('selectAll', () => {
    it('adds all provided ids', () => {
        useQuestionSelection.getState().selectAll(['q-1', 'q-2', 'q-3'])
        const { selectedIds } = useQuestionSelection.getState()

        expect(selectedIds.size).toBe(3)
        expect(selectedIds.has('q-1')).toBe(true)
        expect(selectedIds.has('q-3')).toBe(true)
    })

    it('merges with existing selections (union)', () => {
        useQuestionSelection.getState().toggleSelection('q-0')
        useQuestionSelection.getState().selectAll(['q-1', 'q-2'])

        const { selectedIds } = useQuestionSelection.getState()
        expect(selectedIds.size).toBe(3)
        expect(selectedIds.has('q-0')).toBe(true)
    })

    it('does not duplicate already-selected ids', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        useQuestionSelection.getState().selectAll(['q-1', 'q-2'])

        expect(useQuestionSelection.getState().selectedIds.size).toBe(2)
    })

    it('handles empty array', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        useQuestionSelection.getState().selectAll([])

        expect(useQuestionSelection.getState().selectedIds.size).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// clearSelection
// ---------------------------------------------------------------------------

describe('clearSelection', () => {
    it('removes all selections', () => {
        useQuestionSelection.getState().selectAll(['q-1', 'q-2', 'q-3'])
        useQuestionSelection.getState().clearSelection()

        expect(useQuestionSelection.getState().selectedIds.size).toBe(0)
    })

    it('is safe to call when already empty', () => {
        useQuestionSelection.getState().clearSelection()
        expect(useQuestionSelection.getState().selectedIds.size).toBe(0)
    })
})

// ---------------------------------------------------------------------------
// isSelected
// ---------------------------------------------------------------------------

describe('isSelected', () => {
    it('returns true for selected ids', () => {
        useQuestionSelection.getState().toggleSelection('q-1')
        expect(useQuestionSelection.getState().isSelected('q-1')).toBe(true)
    })

    it('returns false for non-selected ids', () => {
        expect(useQuestionSelection.getState().isSelected('q-999')).toBe(false)
    })
})
