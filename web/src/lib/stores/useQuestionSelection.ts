import { create } from 'zustand'

interface QuestionSelectionState {
    selectedIds: Set<string>
    toggleSelection: (id: string) => void
    selectAll: (ids: string[]) => void
    clearSelection: () => void
    isSelected: (id: string) => boolean
}

export const useQuestionSelection = create<QuestionSelectionState>((set, get) => ({
    selectedIds: new Set(),

    toggleSelection: (id) => set((state) => {
        const next = new Set(state.selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        return { selectedIds: next }
    }),

    selectAll: (ids) => set((state) => {
        const next = new Set(state.selectedIds)
        ids.forEach(id => next.add(id))
        return { selectedIds: next }
    }),

    clearSelection: () => set({ selectedIds: new Set() }),

    isSelected: (id) => get().selectedIds.has(id)
}))
