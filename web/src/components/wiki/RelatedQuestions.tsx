'use client'

import { Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRelatedQuestions } from '@/lib/apiClient'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { RelatedQuestionSkeleton } from '@/components/ui/Skeleton'
import { formatQuestion } from '@/lib/validation/question-formatter'

interface RelatedQuestionsProps {
    activeSlug: string
}

export function RelatedQuestions({ activeSlug }: RelatedQuestionsProps) {
    return (
        <ErrorBoundary>
            <Suspense fallback={<SidebarSkeleton />}>
                <RelatedQuestionsInner slug={activeSlug} />
            </Suspense>
        </ErrorBoundary>
    )
}

function RelatedQuestionsInner({ slug }: { slug: string }) {
    const { data: questions = [], isLoading } = useQuery({
        queryKey: ['related-questions', slug],
        queryFn: () => fetchRelatedQuestions(slug),
        staleTime: 5 * 60 * 1000,
        enabled: Boolean(slug),
    })

    if (isLoading) return <SidebarSkeleton />

    if (questions.length === 0) {
        return (
            <p className="px-4 py-6 text-center text-sm leading-7 text-text-muted">
                此段落暫無關聯題目
            </p>
        )
    }

    const formattedQuestions = questions.map((question) => {
        const result = formatQuestion({
            stem: question.stem,
            options: typeof question.options === 'string'
                ? (JSON.parse(question.options) as Record<string, string>)
                : question.options,
            explanation: question.explanation,
        })

        return {
            ...question,
            stem: result.question.stem,
            options: result.question.options,
        }
    })

    return (
        <ul className="space-y-2 px-2" aria-label="關聯考古題">
            {formattedQuestions.map((question) => {
                const options = Object.keys(question.options).sort().map((key) => question.options[key])
                return (
                    <li
                        key={question.id}
                        className="rounded-[22px] border border-border-base bg-bg-surface p-4 transition-colors hover:border-border-hover hover:bg-surface-muted"
                    >
                        <p className="text-sm font-semibold leading-7 text-text-base">{question.stem}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {options.slice(0, 2).map((option, index) => (
                                <span
                                    key={`${question.id}-${index}`}
                                    className="rounded-full border border-border-base bg-surface-base px-2.5 py-1 text-[11px] font-medium text-text-muted"
                                >
                                    {option}
                                </span>
                            ))}
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}

function SidebarSkeleton() {
    return (
        <div className="space-y-2 px-2">
            {[1, 2, 3].map((item) => (
                <RelatedQuestionSkeleton key={item} />
            ))}
        </div>
    )
}
