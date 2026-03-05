'use client'

import { cn } from '@/lib/cn'

interface SkeletonProps {
    className?: string
}

/**
 * Animated shimmer skeleton used as loading placeholder.
 * Used inside Suspense fallbacks in RelatedQuestions & QuizCard.
 */
export function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            role="status"
            aria-label="載入中"
            className={cn(
                'rounded-lg bg-white/5 animate-pulse',
                className,
            )}
        />
    )
}

/** Pre-built skeleton for a quiz question card */
export function QuestionSkeleton() {
    return (
        <div role="status" aria-label="題目載入中" className="space-y-4 p-6">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="space-y-2 mt-6">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
            </div>
        </div>
    )
}

/** Pre-built skeleton for a wiki sidebar related question */
export function RelatedQuestionSkeleton() {
    return (
        <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
        </div>
    )
}
