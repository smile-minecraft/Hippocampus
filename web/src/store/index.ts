/**
 * @file store/index.ts
 * Unified store exports.
 *
 * Quiz state uses a vanilla store factory (createQuizSlice) so it can be
 * instantiated fresh per quiz session context, whereas uiSlice is a singleton
 * React hook store that persists across the entire app lifetime.
 */

export { createQuizSlice } from './quizSlice'
export type { QuizSlice, QuestionResult } from './quizSlice'

export { useUIStore } from './uiSlice'
export type { UISlice, Theme } from './uiSlice'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createUploadSlice, type UploadSlice } from './uploadSlice'

export const useUploadStore = create<UploadSlice>()(
    persist(
        (...a) => createUploadSlice(...a),
        {
            name: 'hippocampus-upload-storage',
            // Only persist the jobs array
            partialize: (state) => ({ jobs: state.jobs }),
        }
    )
)
