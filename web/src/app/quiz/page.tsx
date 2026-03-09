import type { Metadata } from 'next'
import { fetchTags } from '@/lib/apiClient'
import { QuizDashboard } from '@/components/quiz/QuizDashboard'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { TagsResponse } from '@/types'

export const metadata: Metadata = {
    title: 'Hippocampus — 測驗儀表板',
    description: '自訂測驗範圍與難度選項',
}

export default async function QuizDashboardPage() {
    let tagsData: TagsResponse = { tags: [], grouped: { SUBJECT: [], SYSTEM: [], SOURCE: [], META: [] } }

    try {
        tagsData = await fetchTags()
    } catch (err) {
        console.warn('[QuizDashboardPage] Could not fetch tags:', err)
    }

    return (
        <main className="min-h-screen bg-bg-base px-4 py-8 md:py-12">
            <ErrorBoundary>
                <QuizDashboard tagsData={tagsData} />
            </ErrorBoundary>
        </main>
    )
}
