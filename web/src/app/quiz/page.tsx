import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AppProviders } from '@/components/providers/AppProviders'
import { QuizCard } from '@/components/quiz/QuizCard'
import { fetchQuestions } from '@/lib/apiClient'
import { QuestionSkeleton } from '@/components/ui/Skeleton'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import type { Question } from '@/types'

export const metadata: Metadata = {
    title: 'Hippocampus — 刷題',
    description: '沉浸式醫學考古題練習介面',
}

/**
 * Quiz page — Server Component shell.
 *
 * Prefetches the first batch of questions on the server so `QuizCard`
 * receives `initialQuestions` as a prop. The client component initializes
 * its local Zustand session store with these questions immediately on mount,
 * avoiding any loading state on first render.
 *
 * Tag / difficulty filters will be added as searchParams in Phase 2.
 */
export default async function QuizPage() {
    // Graceful degradation: if Agent B's API is not yet live, render empty session
    let initialQuestions: Question[] = []
    try {
        initialQuestions = await fetchQuestions({ limit: 20 })
    } catch (err) {
        console.warn('[QuizPage] Could not prefetch questions:', err)
    }

    return (
        <main className="min-h-screen bg-bg-base px-4 py-10 transition-colors duration-300">
            <div className="max-w-2xl mx-auto space-y-8">
                <header className="space-y-2">
                    <h1 className="text-3xl font-heading font-bold text-text-base tracking-tight">測驗模式</h1>
                    <p className="text-sm font-medium text-text-muted">
                        快捷鍵：數字鍵選答 · Space 確認 · Esc 跳過
                    </p>
                </header>

                <ErrorBoundary>
                    <Suspense fallback={<QuestionSkeleton />}>
                        <QuizCard initialQuestions={initialQuestions} />
                    </Suspense>
                </ErrorBoundary>
            </div>
        </main>
    )
}
