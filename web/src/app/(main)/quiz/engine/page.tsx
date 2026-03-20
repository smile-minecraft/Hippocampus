import type { Metadata } from 'next'
import { Suspense } from 'react'
import { QuizCard } from '@/components/quiz/QuizCard'
import { fetchQuestions } from '@/lib/apiClient'
import { QuestionSkeleton } from '@/components/ui/Skeleton'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { PageHeader } from '@/components/ui/PageHeader'
import { log } from '@/lib/logger'
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
interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function QuizPage({ searchParams }: PageProps) {
    const params = await searchParams
    const tags = typeof params.tags === 'string' && params.tags ? params.tags.split(',') : []
    const limit = typeof params.limit === 'string' ? parseInt(params.limit, 10) : 20
    const difficulty = typeof params.difficulty === 'string' && params.difficulty ? params.difficulty.split(',').map(Number) : undefined

    // Graceful degradation: if Agent B's API is not yet live, render empty session
    let initialQuestions: Question[] = []
    try {
        initialQuestions = await fetchQuestions({
            limit,
            tagSlugs: tags.length > 0 ? tags : undefined,
            difficulty: difficulty && difficulty.length > 0 ? difficulty : undefined
        })
    } catch (err) {
        log.warn('quiz-page', 'Could not prefetch questions', { error: err instanceof Error ? err.message : String(err) })
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Quiz Engine"
                title="沉浸式作答模式"
                description="作答時會自動收合全域側欄，讓焦點回到題目本身。"
                meta={(
                    <>
                        <span className="pill">數字鍵選答</span>
                        <span className="pill">Space 確認</span>
                        <span className="pill">Esc 跳過</span>
                    </>
                )}
            />

            <div className="mx-auto max-w-2xl">
                <ErrorBoundary>
                    <Suspense fallback={<QuestionSkeleton />}>
                        <QuizCard initialQuestions={initialQuestions} />
                    </Suspense>
                </ErrorBoundary>
            </div>
        </div>
    )
}
