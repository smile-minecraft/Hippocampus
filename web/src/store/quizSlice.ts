/**
 * @file store/quizSlice.ts
 * Zustand slice for quiz session state.
 *
 * Isolation strategy: `ExplanationPanel` subscribes ONLY to `isRevealed`,
 * `OptionButton` subscribes ONLY to `selectedOption` + `currentIndex`.
 * Neither re-renders when `sessionQuestions` array reference changes.
 * Achieved via TanStack Query for server data + Zustand only for local UI state.
 */

import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Question, SessionStats } from '@/types'

// ---------------------------------------------------------------------------
// Per-question answer record for end-of-session review
// ---------------------------------------------------------------------------

export interface QuestionResult {
    questionId: string
    selectedOption: number | null   // null = skipped
    isCorrect: boolean | null       // null = skipped
    correctAnswer: string           // "A"/"B"/"C"/"D"
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface QuizSlice {
    // State
    sessionQuestions: Question[]
    currentIndex: number
    selectedOption: number | null   // null = not yet chosen
    isRevealed: boolean
    sessionStats: SessionStats
    questionResults: QuestionResult[]

    // Derived (computed inline — no selector overhead)
    currentQuestion: () => Question | undefined

    // Actions
    selectOption: (index: number) => void
    revealAnswer: () => void
    nextQuestion: () => void
    resetSession: (questions: Question[]) => void
    skipQuestion: () => void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createQuizSlice = () =>
    createStore(
        subscribeWithSelector<QuizSlice>((set, get) => ({
            // ---- Initial state ----
            sessionQuestions: [],
            currentIndex: 0,
            selectedOption: null,
            isRevealed: false,
            sessionStats: { correct: 0, wrong: 0, skipped: 0 },
            questionResults: [],

            // ---- Derived ----
            currentQuestion: () => get().sessionQuestions[get().currentIndex],

            // ---- Actions ----
            selectOption: (index) => {
                // Guard: cannot change answer after reveal
                if (get().isRevealed) return
                set({ selectedOption: index })
            },

            revealAnswer: () => {
                const { selectedOption, isRevealed, currentQuestion, sessionStats, questionResults } = get()
                if (isRevealed || selectedOption === null) return

                const q = currentQuestion()
                if (!q) return

                const mappedAnswers = ["A", "B", "C", "D"];
                const isCorrect = mappedAnswers[selectedOption] === q.answer;
                set({
                    isRevealed: true,
                    sessionStats: {
                        ...sessionStats,
                        correct: isCorrect ? sessionStats.correct + 1 : sessionStats.correct,
                        wrong: !isCorrect ? sessionStats.wrong + 1 : sessionStats.wrong,
                    },
                    questionResults: [
                        ...questionResults,
                        {
                            questionId: q.id,
                            selectedOption,
                            isCorrect,
                            correctAnswer: q.answer,
                        },
                    ],
                })
            },

            nextQuestion: () => {
                const { currentIndex, sessionQuestions } = get()
                if (currentIndex >= sessionQuestions.length - 1) {
                    // Last question — advance index to trigger end screen
                    set({ currentIndex: currentIndex + 1, selectedOption: null, isRevealed: false })
                    return
                }
                set({
                    currentIndex: currentIndex + 1,
                    selectedOption: null,
                    isRevealed: false,
                })
            },

            skipQuestion: () => {
                const { currentIndex, sessionQuestions, isRevealed, sessionStats, questionResults } = get()
                const q = get().currentQuestion()
                const newResults = !isRevealed && q
                    ? [...questionResults, { questionId: q.id, selectedOption: null, isCorrect: null, correctAnswer: q.answer }]
                    : questionResults

                if (currentIndex >= sessionQuestions.length - 1) {
                    // Last question — advance index to trigger end screen
                    set({
                        currentIndex: currentIndex + 1,
                        selectedOption: null,
                        isRevealed: false,
                        sessionStats: {
                            ...sessionStats,
                            skipped: !isRevealed ? sessionStats.skipped + 1 : sessionStats.skipped,
                        },
                        questionResults: newResults,
                    })
                    return
                }

                set({
                    currentIndex: currentIndex + 1,
                    selectedOption: null,
                    isRevealed: false,
                    sessionStats: {
                        ...sessionStats,
                        // Only count as skipped if the question was never answered
                        skipped: !isRevealed
                            ? sessionStats.skipped + 1
                            : sessionStats.skipped,
                    },
                    questionResults: newResults,
                })
            },

            resetSession: (questions) =>
                set({
                    sessionQuestions: questions,
                    currentIndex: 0,
                    selectedOption: null,
                    isRevealed: false,
                    sessionStats: { correct: 0, wrong: 0, skipped: 0 },
                    questionResults: [],
                }),
        })),
    )
