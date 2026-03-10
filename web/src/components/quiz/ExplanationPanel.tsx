'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, BookOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LatexText } from '@/components/ui/LatexText'

interface ExplanationPanelProps {
    isRevealed: boolean
    isCorrect: boolean
    explanation: string | null
    wikiSlug?: string   // Optional — links to related Wiki article
}

/**
 * Animated explanation panel that expands below the question options
 * when the user reveals the answer.
 *
 * Animation strategy:
 *   `layout` prop on the wrapping element lets Framer Motion automatically
 *   animate the height change without requiring hard-coded values.
 *   `initial={{ opacity: 0, y: 8 }}` prevents layout shift flicker.
 *
 * A11y:
 *   `aria-live="polite"` announces content to screen readers after reveal.
 *   `role="status"` is appropriate for non-urgent informational updates.
 */
export function ExplanationPanel({
    isRevealed,
    isCorrect,
    explanation,
    wikiSlug,
}: ExplanationPanelProps) {
    return (
        <AnimatePresence mode="wait">
            {isRevealed && (
                <motion.div
                    key="explanation"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className={cn(
                        'rounded-xl border p-5 space-y-3',
                        isCorrect
                            ? 'border-cta-base/30 bg-cta-base/5'
                            : 'border-red-500/30 bg-red-500/5',
                    )}
                >
                    {/* Result badge */}
                    <div className="flex items-center gap-2">
                        {isCorrect ? (
                            <CheckCircle className="size-5 text-cta-base flex-shrink-0" aria-hidden />
                        ) : (
                            <XCircle className="size-5 text-red-500 flex-shrink-0" aria-hidden />
                        )}
                        <span
                            className={cn(
                                'text-base font-heading font-semibold',
                                isCorrect ? 'text-cta-hover' : 'text-red-600',
                            )}
                        >
                            {isCorrect ? '回答正確！' : '回答錯誤'}
                        </span>
                    </div>

                    {/* Explanation text */}
                    {explanation ? (
                        <LatexText className="text-base text-text-base leading-relaxed">{explanation}</LatexText>
                    ) : (
                        <p className="text-sm text-text-muted italic">（暫無詳解）</p>
                    )}

                    {/* Wiki link */}
                    {wikiSlug && (
                        <motion.a
                            href={`/wiki/${wikiSlug}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className={cn(
                                'inline-flex items-center gap-1.5 text-sm font-medium',
                                'text-primary-base hover:text-primary-hover transition-colors',
                            )}
                        >
                            <BookOpen className="size-3.5" aria-hidden />
                            查看知識條目
                        </motion.a>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    )
}
