'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuizKeyboard } from './useQuizKeyboard'
import { OptionButton } from './OptionButton'
import { ExplanationPanel } from './ExplanationPanel'
import { Button } from '@/components/ui/Button'
import { createQuizSlice } from '@/store/quizSlice'
import { submitAttempt } from '@/lib/apiClient'
import type { Question } from '@/types'
import { cn } from '@/lib/cn'
import { ChevronRight, SkipForward } from 'lucide-react'

interface QuizCardProps {
    initialQuestions: Question[]
}

/**
 * QuizCard is the top-level client component for the immersive quiz engine.
 * It owns a local Zustand store instance (createQuizSlice) scoped to the
 * current session — not a singleton, so multiple quiz sessions can coexist
 * without state leakage.
 *
 * Animation:
 *   Card slides in from the right on question change (AnimatePresence mode="wait").
 *   During the slide animation, keyboard shortcuts are disabled via `isAnimating`.
 *
 * Server interaction:
 *   After reveal, `submitAttempt` is called fire-and-forget. We don't block
 *   the UI on this — if it fails, the attempt is simply not recorded (acceptable
 *   for MVP; retry queue can be added in Phase 2).
 */
export function QuizCard({ initialQuestions }: QuizCardProps) {
    // Local session store — not exported to global Zustand
    const storeRef = useRef(createQuizSlice())

    // Subscribe only to the fields we need (prevents full re-render on other changes)
    const sessionQuestions = storeRef.current.getState().sessionQuestions
    const [state, setState] = useState(() => storeRef.current.getState())

    // Re-sync local state on store changes — subscribe on mount, unsubscribe on unmount
    useEffect(() => {
        return storeRef.current.subscribe((s) => setState({ ...s }))
    }, [])

    const [isAnimating, setIsAnimating] = useState(false)

    // Initialize session once on mount
    const didInit = useRef(false)
    if (!didInit.current && initialQuestions.length > 0) {
        storeRef.current.getState().resetSession(initialQuestions)
        didInit.current = true
    }

    const currentQuestion = state.sessionQuestions[state.currentIndex]
    const totalCount = state.sessionQuestions.length

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleSelect = useCallback((index: number) => {
        storeRef.current.getState().selectOption(index)
    }, [])

    const handleRevealOrNext = useCallback(() => {
        const s = storeRef.current.getState()
        if (!s.isRevealed && s.selectedOption !== null) {
            s.revealAnswer()
            // Fire-and-forget attempt recording
            if (currentQuestion) {
                const mappedAnswer = ["A", "B", "C", "D"][s.selectedOption] as "A" | "B" | "C" | "D"
                void submitAttempt({
                    questionId: currentQuestion.id,
                    userAnswer: mappedAnswer,
                }).catch((err) => {
                    console.warn('[QuizCard] submitAttempt failed (non-blocking):', err)
                })
            }
        } else if (s.isRevealed) {
            s.nextQuestion()
        }
    }, [currentQuestion])

    const handleSkip = useCallback(() => {
        storeRef.current.getState().skipQuestion()
    }, [])

    // ---------------------------------------------------------------------------
    // Keyboard shortcuts
    // ---------------------------------------------------------------------------

    useQuizKeyboard({
        onSelectOption: handleSelect,
        onRevealOrNext: handleRevealOrNext,
        onSkip: handleSkip,
        isDisabled: isAnimating,
    })

    // ---------------------------------------------------------------------------
    // Render guard
    // ---------------------------------------------------------------------------

    if (!currentQuestion) {
        return (
            <div className="text-center py-20 text-text-muted space-y-2">
                <p className="text-4xl">🎉</p>
                <p className="text-lg font-heading font-medium text-text-base">本輪題目已完成！</p>
                <p className="text-sm">
                    答對 {state.sessionStats.correct} / 跳過 {state.sessionStats.skipped} / 答錯 {state.sessionStats.wrong}
                </p>
            </div>
        )
    }

    const optionsObj = typeof currentQuestion.options === 'string'
        ? JSON.parse(currentQuestion.options as any)
        : currentQuestion.options;

    // Convert Record<string, string> to array of values in order (A, B, C, D)
    const options: string[] = Object.keys(optionsObj).sort().map(k => optionsObj[k]);

    // ---------------------------------------------------------------------------
    // JSX
    // ---------------------------------------------------------------------------

    return (
        <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
            {/* Progress bar */}
            <div className="flex items-center gap-3" aria-label="答題進度">
                <div className="flex-1 h-2 bg-border-base rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-primary-base rounded-full"
                        initial={false}
                        animate={{ width: `${((state.currentIndex) / totalCount) * 100}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                </div>
                <span className="text-xs font-semibold text-text-muted font-mono tabular-nums">
                    {state.currentIndex + 1} / {totalCount}
                </span>
            </div>

            {/* Card */}
            <AnimatePresence
                mode="wait"
                onExitComplete={() => setIsAnimating(false)}
            >
                <motion.div
                    key={currentQuestion.id}
                    initial={{ opacity: 0, x: 32 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -32 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    onAnimationStart={() => setIsAnimating(true)}
                    onAnimationComplete={() => setIsAnimating(false)}
                    className="card p-6 md:p-8 space-y-6"
                >
                    {/* Difficulty badge */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted font-medium">
                            難度 {'★'.repeat(currentQuestion.difficulty)}{'☆'.repeat(5 - currentQuestion.difficulty)}
                        </span>
                    </div>

                    {/* Question body */}
                    <p
                        className="text-text-base text-lg leading-relaxed font-medium"
                        aria-label="題目"
                    >
                        {currentQuestion.stem}
                    </p>

                    {/* Options */}
                    <div role="radiogroup" aria-label="選項" className="space-y-2.5">
                        {options.map((label, i) => (
                            <OptionButton
                                key={i}
                                index={i}
                                label={label}
                                isSelected={state.selectedOption === i}
                                isCorrect={['A', 'B', 'C', 'D'][i] === currentQuestion.answer}
                                isRevealed={state.isRevealed}
                                onSelect={handleSelect}
                            />
                        ))}
                    </div>

                    {/* Explanation */}
                    <ExplanationPanel
                        isRevealed={state.isRevealed}
                        isCorrect={['A', 'B', 'C', 'D'][state.selectedOption ?? 0] === currentQuestion.answer}
                        explanation={currentQuestion.explanation}
                    />

                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleSkip}
                            disabled={state.isRevealed}
                            aria-label="跳過此題 (Esc)"
                        >
                            <SkipForward className="size-4" aria-hidden />
                            跳過
                        </Button>
                        <Button
                            variant={state.isRevealed ? 'secondary' : 'primary'}
                            size="sm"
                            onClick={handleRevealOrNext}
                            disabled={!state.isRevealed && state.selectedOption === null}
                            aria-label={state.isRevealed ? '下一題 (Space)' : '確認作答 (Space)'}
                        >
                            {state.isRevealed ? '下一題' : '確認'}
                            <ChevronRight className="size-4" aria-hidden />
                        </Button>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    )
}
