import { describe, it, expect, beforeEach } from 'vitest'
import { createQuizSlice, type QuizSlice } from '../quizSlice'
import type { Question } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<Question> = {}): Question {
    return {
        id: crypto.randomUUID(),
        year: 2024,
        examType: '期中考',
        stem: '下列何者正確？',
        options: { A: '選項A', B: '選項B', C: '選項C', D: '選項D' },
        answer: 'B',
        explanation: '因為 B 是正確答案',
        imageUrls: [],
        difficulty: 3,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    }
}

function makeQuestions(n: number): Question[] {
    return Array.from({ length: n }, (_, i) =>
        makeQuestion({ id: `q-${i}`, answer: (['A', 'B', 'C', 'D'] as const)[i % 4] }),
    )
}

type Store = ReturnType<typeof createQuizSlice>

describe('quizSlice — Zustand store actions', () => {
    let store: Store
    let get: () => QuizSlice

    beforeEach(() => {
        store = createQuizSlice()
        get = store.getState
    })

    // ─── resetSession ──────────────────────────────────────────────────

    describe('resetSession', () => {
        it('loads questions and resets all state', () => {
            const questions = makeQuestions(5)
            get().resetSession(questions)

            expect(get().sessionQuestions).toHaveLength(5)
            expect(get().currentIndex).toBe(0)
            expect(get().selectedOption).toBeNull()
            expect(get().isRevealed).toBe(false)
            expect(get().sessionStats).toEqual({ correct: 0, wrong: 0, skipped: 0 })
            expect(get().questionResults).toEqual([])
        })

        it('clears previous session state when called again', () => {
            const q1 = makeQuestions(3)
            get().resetSession(q1)
            get().selectOption(0)
            get().revealAnswer()

            const q2 = makeQuestions(2)
            get().resetSession(q2)

            expect(get().sessionQuestions).toHaveLength(2)
            expect(get().sessionStats.correct).toBe(0)
            expect(get().questionResults).toEqual([])
        })
    })

    // ─── selectOption ──────────────────────────────────────────────────

    describe('selectOption', () => {
        it('sets the selected option index', () => {
            get().resetSession(makeQuestions(1))
            get().selectOption(2)

            expect(get().selectedOption).toBe(2)
        })

        it('allows changing selection before reveal', () => {
            get().resetSession(makeQuestions(1))
            get().selectOption(0)
            get().selectOption(3)

            expect(get().selectedOption).toBe(3)
        })

        it('blocks selection after reveal', () => {
            get().resetSession(makeQuestions(1))
            get().selectOption(1) // answer is 'A' for q-0 (index 0)
            get().revealAnswer()
            get().selectOption(3) // should be ignored

            expect(get().selectedOption).toBe(1)
        })
    })

    // ─── revealAnswer ──────────────────────────────────────────────────

    describe('revealAnswer', () => {
        it('marks correct answer and increments correct count', () => {
            // q-0 answer is 'A' = index 0
            get().resetSession(makeQuestions(3))
            get().selectOption(0) // select A
            get().revealAnswer()

            expect(get().isRevealed).toBe(true)
            expect(get().sessionStats.correct).toBe(1)
            expect(get().sessionStats.wrong).toBe(0)
            expect(get().questionResults).toHaveLength(1)
            expect(get().questionResults[0]).toMatchObject({
                questionId: 'q-0',
                selectedOption: 0,
                isCorrect: true,
                correctAnswer: 'A',
            })
        })

        it('marks wrong answer and increments wrong count', () => {
            // q-0 answer is 'A' (index 0), selecting index 2 (C) should be wrong
            get().resetSession(makeQuestions(3))
            get().selectOption(2)
            get().revealAnswer()

            expect(get().sessionStats.wrong).toBe(1)
            expect(get().sessionStats.correct).toBe(0)
            expect(get().questionResults[0].isCorrect).toBe(false)
        })

        it('is a no-op when no option selected', () => {
            get().resetSession(makeQuestions(1))
            get().revealAnswer() // nothing selected

            expect(get().isRevealed).toBe(false)
            expect(get().questionResults).toHaveLength(0)
        })

        it('is a no-op when already revealed', () => {
            get().resetSession(makeQuestions(1))
            get().selectOption(0)
            get().revealAnswer()
            get().revealAnswer() // double reveal

            expect(get().sessionStats.correct).toBe(1) // not double counted
            expect(get().questionResults).toHaveLength(1)
        })
    })

    // ─── nextQuestion ──────────────────────────────────────────────────

    describe('nextQuestion', () => {
        it('advances to the next question and resets UI state', () => {
            get().resetSession(makeQuestions(3))
            get().selectOption(0)
            get().revealAnswer()
            get().nextQuestion()

            expect(get().currentIndex).toBe(1)
            expect(get().selectedOption).toBeNull()
            expect(get().isRevealed).toBe(false)
        })

        it('advances past last question (triggers end screen)', () => {
            get().resetSession(makeQuestions(2))

            // Answer both questions
            get().selectOption(0)
            get().revealAnswer()
            get().nextQuestion() // index 1

            get().selectOption(1)
            get().revealAnswer()
            get().nextQuestion() // index 2 = past end

            expect(get().currentIndex).toBe(2)
            expect(get().currentQuestion()).toBeUndefined()
        })
    })

    // ─── skipQuestion ──────────────────────────────────────────────────

    describe('skipQuestion', () => {
        it('increments skipped count and records null result', () => {
            get().resetSession(makeQuestions(3))
            get().skipQuestion()

            expect(get().sessionStats.skipped).toBe(1)
            expect(get().currentIndex).toBe(1)
            expect(get().questionResults).toHaveLength(1)
            expect(get().questionResults[0]).toMatchObject({
                questionId: 'q-0',
                selectedOption: null,
                isCorrect: null,
            })
        })

        it('does not double-count skip if question was already revealed', () => {
            get().resetSession(makeQuestions(3))
            get().selectOption(0)
            get().revealAnswer()
            get().skipQuestion() // skip after reveal = just advance

            expect(get().sessionStats.skipped).toBe(0)
            expect(get().sessionStats.correct).toBe(1)
            // No duplicate result appended
            expect(get().questionResults).toHaveLength(1)
        })

        it('advances past last question when skipping at end', () => {
            get().resetSession(makeQuestions(1))
            get().skipQuestion()

            expect(get().currentIndex).toBe(1)
            expect(get().currentQuestion()).toBeUndefined()
            expect(get().sessionStats.skipped).toBe(1)
        })
    })

    // ─── currentQuestion ───────────────────────────────────────────────

    describe('currentQuestion', () => {
        it('returns the question at currentIndex', () => {
            const questions = makeQuestions(3)
            get().resetSession(questions)

            expect(get().currentQuestion()?.id).toBe('q-0')
            get().nextQuestion()
            expect(get().currentQuestion()?.id).toBe('q-1')
        })

        it('returns undefined when no questions loaded', () => {
            expect(get().currentQuestion()).toBeUndefined()
        })

        it('returns undefined when index is past the end', () => {
            get().resetSession(makeQuestions(1))
            get().skipQuestion() // advances past

            expect(get().currentQuestion()).toBeUndefined()
        })
    })

    // ─── Full session simulation ───────────────────────────────────────

    describe('full session flow', () => {
        it('correctly tracks stats across a 4-question session', () => {
            // q-0: answer A (idx 0), q-1: answer B (idx 1), q-2: answer C (idx 2), q-3: answer D (idx 3)
            get().resetSession(makeQuestions(4))

            // Q0: answer correctly (A = idx 0)
            get().selectOption(0)
            get().revealAnswer()
            get().nextQuestion()

            // Q1: answer incorrectly (A = idx 0, correct is B = idx 1)
            get().selectOption(0)
            get().revealAnswer()
            get().nextQuestion()

            // Q2: skip
            get().skipQuestion()

            // Q3: answer correctly (D = idx 3)
            get().selectOption(3)
            get().revealAnswer()
            get().nextQuestion() // past end

            expect(get().sessionStats).toEqual({ correct: 2, wrong: 1, skipped: 1 })
            expect(get().questionResults).toHaveLength(4)
            expect(get().questionResults.map(r => r.isCorrect)).toEqual([true, false, null, true])
            expect(get().currentQuestion()).toBeUndefined()
        })
    })
})
