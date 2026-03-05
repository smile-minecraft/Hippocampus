'use client'

import { cn } from '@/lib/cn'

interface OptionButtonProps {
    index: number        // 0-3
    label: string        // Option text
    isSelected: boolean
    isCorrect: boolean   // Whether this is the correct answer
    isRevealed: boolean  // Whether answer has been revealed
    onSelect: (index: number) => void
}

const LETTERS = ['A', 'B', 'C', 'D'] as const

/**
 * Single quiz option button.
 *
 * Visual states (mutually exclusive priority):
 *   revealed + correct → green ring
 *   revealed + selected + !correct → red ring (wrong answer chosen)
 *   selected + !revealed → indigo ring (pending)
 *   none → neutral
 *
 * A11y:
 *   - `role="radio"` in a `radiogroup` context (set on parent)
 *   - `aria-checked` for screen reader state announcement
 *   - `aria-label` includes the letter prefix for clear reading
 *   - `data-index` for keyboard shortcut highlighting (1-4 keys)
 */
export function OptionButton({
    index,
    label,
    isSelected,
    isCorrect,
    isRevealed,
    onSelect,
}: OptionButtonProps) {
    const letter = LETTERS[index]

    const colorClass = (() => {
        if (isRevealed && isCorrect)
            return 'border-cta-base/30 bg-cta-base/10 text-cta-base shadow-elevation-1'
        if (isRevealed && isSelected && !isCorrect)
            return 'border-red-500/30 bg-red-500/10 text-red-600 shadow-elevation-1'
        if (isSelected && !isRevealed)
            return 'border-primary-base bg-primary-base/10 text-primary-base shadow-elevation-1'
        return 'border-border-base bg-bg-surface text-text-base hover:border-border-base hover:bg-border-base/50'
    })()

    return (
        <button
            role="radio"
            aria-checked={isSelected}
            aria-label={`選項 ${letter}：${label}`}
            data-index={index}
            disabled={isRevealed && !isCorrect && !isSelected}
            onClick={() => !isRevealed && onSelect(index)}
            className={cn(
                'group relative w-full flex items-center gap-3 px-4 py-3 rounded-xl border',
                'text-left text-base font-medium transition-all duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-base/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
                'disabled:cursor-not-allowed disabled:opacity-50',
                colorClass,
            )}
        >
            {/* Keyboard shortcut badge */}
            <span
                aria-hidden
                className={cn(
                    'flex-shrink-0 size-7 rounded-md border text-xs font-bold font-mono tracking-tighter',
                    'flex items-center justify-center transition-colors',
                    isSelected || (isRevealed && isCorrect)
                        ? 'border-current bg-current/10'
                        : 'border-border-base bg-bg-base group-hover:border-border-base',
                )}
            >
                {letter}
            </span>
            <span className="flex-1 leading-snug">{label}</span>
        </button>
    )
}
