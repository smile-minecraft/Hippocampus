'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuizKeyboard } from './useQuizKeyboard'
import { OptionButton } from './OptionButton'
import { ExplanationPanel } from './ExplanationPanel'
import { Button } from '@/components/ui/Button'
import { LatexText } from '@/components/ui/LatexText'
import { createQuizSlice } from '@/store/quizSlice'
import type { QuestionResult } from '@/store/quizSlice'
import { submitAttempt } from '@/lib/apiClient'
import { log } from '@/lib/logger'
import type { Question } from '@/types'
import { formatQuestion } from '@/lib/validation/question-formatter'
import { ChevronRight, SkipForward, RotateCcw, ChevronDown, ChevronUp, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import Image from 'next/image'

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
    // Using useState instead of useRef to avoid ref-during-render lint violations.
    // The store is created once via the initializer function and never changes.
    const [store] = useState(() => createQuizSlice())

    const [state, setState] = useState(() => store.getState())

    // Re-sync local state on store changes — subscribe on mount, unsubscribe on unmount
    useEffect(() => {
        return store.subscribe((s) => setState({ ...s }))
    }, [store])

    const [isAnimating, setIsAnimating] = useState(false)

    // Initialize session once on mount
    const didInit = useRef(false)
    useEffect(() => {
        if (!didInit.current && initialQuestions.length > 0) {
            // Format questions to extract any embedded options from stems
            const formattedQuestions = initialQuestions.map(q => {
                const result = formatQuestion({
                    stem: q.stem,
                    options: typeof q.options === 'string'
                        ? (JSON.parse(q.options) as Record<string, string>)
                        : q.options,
                    explanation: q.explanation,
                })
                return {
                    ...q,
                    stem: result.question.stem,
                    options: result.question.options,
                    explanation: result.question.explanation ?? null,
                }
            })
            store.getState().resetSession(formattedQuestions)
            didInit.current = true
        }
    }, [initialQuestions, store])

    const currentQuestion = state.sessionQuestions[state.currentIndex]
    const totalCount = state.sessionQuestions.length

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleSelect = useCallback((index: number) => {
        store.getState().selectOption(index)
    }, [store])

    const handleRevealOrNext = useCallback(() => {
        const s = store.getState()
        if (!s.isRevealed && s.selectedOption !== null) {
            s.revealAnswer()
            // Fire-and-forget attempt recording
            if (currentQuestion) {
                void submitAttempt({
                    questionId: currentQuestion.id,
                    userAnswer: s.selectedOption,  // numeric 0-3 matches server schema
                }).catch((err) => {
                    log.warn('quiz', 'submitAttempt failed (non-blocking)', { error: err instanceof Error ? err.message : String(err) })
                })
            }
        } else if (s.isRevealed) {
            s.nextQuestion()
        }
    }, [currentQuestion, store])

    const handleSkip = useCallback(() => {
        store.getState().skipQuestion()
    }, [store])

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
    // Render guard — end of session
    // ---------------------------------------------------------------------------

    if (!currentQuestion) {
        return (
            <SessionReview
                stats={state.sessionStats}
                results={state.questionResults}
                questions={state.sessionQuestions}
                onRestart={() => store.getState().resetSession(state.sessionQuestions)}
            />
        )
    }

    const optionsObj = typeof currentQuestion.options === 'string'
        ? (JSON.parse(currentQuestion.options) as Record<string, string>)
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
                    <div aria-label="題目" className="space-y-3">
                        <LatexText className="text-text-base text-lg leading-relaxed font-medium">
                            {currentQuestion.stem}
                        </LatexText>

                        {/* Question images */}
                        {currentQuestion.imageUrls?.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {currentQuestion.imageUrls.map((url, i) => (
                                    <Image
                                        key={i}
                                        src={url}
                                        alt={`題目圖片 ${i + 1}`}
                                        width={600}
                                        height={400}
                                        className="max-w-full rounded-lg border border-border-base object-contain max-h-64"
                                        loading="lazy"
                                        unoptimized
                                    />
                                ))}
                            </div>
                        )}
                    </div>

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

// ---------------------------------------------------------------------------
// SessionReview — detailed end-of-session review
// ---------------------------------------------------------------------------

const LETTERS = ['A', 'B', 'C', 'D'] as const

interface SessionReviewProps {
    stats: { correct: number; wrong: number; skipped: number }
    results: QuestionResult[]
    questions: Question[]
    onRestart: () => void
}

function SessionReview({ stats, results, questions, onRestart }: SessionReviewProps) {
    const router = useRouter()
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [filter, setFilter] = useState<'all' | 'wrong' | 'skipped'>('all')

    const total = stats.correct + stats.wrong + stats.skipped
    const accuracy = total > 0 ? Math.round((stats.correct / total) * 100) : 0

    const questionsMap = new Map(questions.map(q => [q.id, q]))

    const filteredResults = results.filter(r => {
        if (filter === 'wrong') return r.isCorrect === false
        if (filter === 'skipped') return r.isCorrect === null
        return true
    })

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Summary card */}
            <div className="card p-6 space-y-4 text-center">
                <p className="text-4xl">
                    {accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚'}
                </p>
                <h2 className="text-2xl font-heading font-bold text-text-base">
                    本輪完成！
                </h2>

                {/* Accuracy ring */}
                <div className="flex justify-center">
                    <div className="relative size-28">
                        <svg viewBox="0 0 36 36" className="size-28 -rotate-90">
                            <circle
                                cx="18" cy="18" r="15.9"
                                fill="none" stroke="currentColor"
                                strokeWidth="2.5"
                                className="text-border-base"
                            />
                            <circle
                                cx="18" cy="18" r="15.9"
                                fill="none"
                                strokeWidth="2.5"
                                strokeDasharray={`${accuracy}, 100`}
                                strokeLinecap="round"
                                className={accuracy >= 80 ? 'text-cta-base' : accuracy >= 50 ? 'text-amber-500' : 'text-red-500'}
                                stroke="currentColor"
                            />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold font-mono text-text-base">
                            {accuracy}%
                        </span>
                    </div>
                </div>

                {/* Stats row */}
                <div className="flex justify-center gap-6 text-sm font-medium">
                    <span className="text-cta-base">
                        <CheckCircle2 className="size-4 inline mr-1" />
                        答對 {stats.correct}
                    </span>
                    <span className="text-red-500">
                        <XCircle className="size-4 inline mr-1" />
                        答錯 {stats.wrong}
                    </span>
                    <span className="text-text-muted">
                        <MinusCircle className="size-4 inline mr-1" />
                        跳過 {stats.skipped}
                    </span>
                </div>

                {/* Action buttons */}
                <div className="flex justify-center gap-3 pt-2">
                    <Button variant="primary" size="sm" onClick={onRestart}>
                        <RotateCcw className="size-4" aria-hidden />
                        重新作答
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => router.push('/quiz')}>
                        返回題庫
                    </Button>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2">
                {([
                    ['all', `全部 (${results.length})`],
                    ['wrong', `答錯 (${stats.wrong})`],
                    ['skipped', `跳過 (${stats.skipped})`],
                ] as const).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            filter === key
                                ? 'bg-primary-base text-white'
                                : 'bg-bg-surface text-text-muted hover:bg-border-base/50'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Per-question review list */}
            <div className="space-y-3">
                {filteredResults.map((result, idx) => {
                    const q = questionsMap.get(result.questionId)
                    if (!q) return null
                    const isExpanded = expandedId === result.questionId

                    return (
                        <div
                            key={result.questionId}
                            className="card overflow-hidden"
                        >
                            {/* Collapsed header */}
                            <button
                                onClick={() => setExpandedId(isExpanded ? null : result.questionId)}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-surface/50 transition-colors"
                            >
                                {/* Status icon */}
                                {result.isCorrect === true && (
                                    <CheckCircle2 className="size-5 flex-shrink-0 text-cta-base" />
                                )}
                                {result.isCorrect === false && (
                                    <XCircle className="size-5 flex-shrink-0 text-red-500" />
                                )}
                                {result.isCorrect === null && (
                                    <MinusCircle className="size-5 flex-shrink-0 text-text-muted" />
                                )}

                                {/* Question number + truncated stem */}
                                <span className="text-xs font-mono text-text-muted flex-shrink-0">
                                    Q{idx + 1}
                                </span>
                                <span className="flex-1 text-sm text-text-base truncate">
                                    {q.stem.slice(0, 80)}{q.stem.length > 80 ? '…' : ''}
                                </span>

                                {/* User answer vs correct */}
                                <span className="text-xs font-mono text-text-muted flex-shrink-0">
                                    {result.selectedOption !== null
                                        ? LETTERS[result.selectedOption]
                                        : '—'}
                                    {' / '}
                                    <span className="text-cta-base">{result.correctAnswer}</span>
                                </span>

                                {isExpanded
                                    ? <ChevronUp className="size-4 text-text-muted flex-shrink-0" />
                                    : <ChevronDown className="size-4 text-text-muted flex-shrink-0" />
                                }
                            </button>

                            {/* Expanded detail */}
                            {isExpanded && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border-base pt-3">
                                    <LatexText className="text-text-base text-sm leading-relaxed">
                                        {q.stem}
                                    </LatexText>

                                    {/* Options with correct/wrong highlighting */}
                                    <div className="space-y-1.5">
                                        {Object.keys(q.options).sort().map((key, i) => {
                                            const optionText = (q.options as Record<string, string>)[key]
                                            const isCorrectOption = key === result.correctAnswer
                                            const isUserPick = result.selectedOption === i

                                            let colorClass = 'bg-bg-surface text-text-muted'
                                            if (isCorrectOption) colorClass = 'bg-cta-base/10 text-cta-base border border-cta-base/30'
                                            else if (isUserPick && !isCorrectOption) colorClass = 'bg-red-500/10 text-red-600 border border-red-500/30'

                                            return (
                                                <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${colorClass}`}>
                                                    <span className="font-mono font-bold text-xs w-5">{key}</span>
                                                    <LatexText className="flex-1">{optionText}</LatexText>
                                                    {isUserPick && !isCorrectOption && <span className="text-xs">(你的答案)</span>}
                                                    {isCorrectOption && <span className="text-xs">(正確)</span>}
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* Explanation */}
                                    {q.explanation && (
                                        <div className="bg-bg-surface rounded-lg px-3 py-2 text-sm text-text-muted">
                                            <span className="font-medium text-text-base">解析：</span>
                                            <LatexText>{q.explanation}</LatexText>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}

                {filteredResults.length === 0 && (
                    <p className="text-center text-text-muted text-sm py-8">
                        此分類無題目
                    </p>
                )}
            </div>
        </div>
    )
}
