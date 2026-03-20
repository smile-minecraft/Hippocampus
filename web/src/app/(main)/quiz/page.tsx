import type { Metadata } from 'next'
import { fetchTags } from '@/lib/apiClient'
import { QuizDashboard } from '@/components/quiz/QuizDashboard'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { log } from '@/lib/logger'
import { TagsResponse } from '@/types'

export const metadata: Metadata = {
    title: 'Hippocampus — 測驗儀表板',
    description: '自訂測驗範圍與難度選項',
}

export default async function QuizDashboardPage() {
    let tagsData: TagsResponse = { tags: [], grouped: { ACADEMIC: [], ORGAN: [], EXAM_CATEGORY: [], META: [] } }

    try {
        tagsData = await fetchTags()
    } catch (err) {
        log.warn('quiz-page', 'Could not fetch tags', { error: err instanceof Error ? err.message : String(err) })
    }

    return (
        <ErrorBoundary>
            <QuizDashboard tagsData={tagsData} />
        </ErrorBoundary>
    )
}
