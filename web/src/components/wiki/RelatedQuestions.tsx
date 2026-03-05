'use client'

import { useState, useTransition, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRelatedQuestions } from '@/lib/apiClient'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { RelatedQuestionSkeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'

interface RelatedQuestionsProps {
    /** Initially active slug — derived from SSR prefetch */
    initialSlug: string
}

/**
 * Sidebar panel that dynamically shows questions related to the currently
 * visible article section.
 *
 * Data flow:
 *   ArticleReader (parent) tracks the active slug via IntersectionObserver
 *   and calls setActiveSlug (passed as prop) which triggers this component.
 *
 * Concurrency:
 *   `startTransition` wraps the slug state update to mark it as non-urgent.
 *   React 19 will yield to higher-priority interactions (scroll, text selection)
 *   before processing the sidebar re-render, preventing dropped frames.
 *
 * Cache:
 *   TanStack Query provides transparent caching — same slug = instant cache hit,
 *   no duplicate network requests.
 */
export function RelatedQuestions({ initialSlug }: RelatedQuestionsProps) {
    const [activeSlug, setActiveSlug] = useState(initialSlug)
    const [, startTransition] = useTransition()

    // Exposed for parent (ArticleReader) to call on intersection change
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const updateSlug = (slug: string) => {
        startTransition(() => {
            setActiveSlug(slug)
        })
    }

        // Expose updater so ArticleReader can wire it up
        ; (RelatedQuestions as { _updateSlug?: typeof updateSlug })._updateSlug = updateSlug

    return (
        <ErrorBoundary>
            <Suspense fallback={<SidebarSkeleton />}>
                <RelatedQuestionsInner slug={activeSlug} />
            </Suspense>
        </ErrorBoundary>
    )
}

// ---------------------------------------------------------------------------
// Inner fetching component
// ---------------------------------------------------------------------------

function RelatedQuestionsInner({ slug }: { slug: string }) {
    const { data: questions = [], isLoading } = useQuery({
        queryKey: ['related-questions', slug],
        queryFn: () => fetchRelatedQuestions(slug),
        staleTime: 5 * 60 * 1000,
        enabled: !!slug,
    })

    if (isLoading) return <SidebarSkeleton />

    if (questions.length === 0) {
        return (
            <p className="text-xs text-zinc-500 px-4 py-6 text-center">
                此段落暫無關聯題目
            </p>
        )
    }

    return (
        <ul className="space-y-2 px-2" aria-label="關聯考古題">
            {questions.map((q) => {
                const options: string[] = JSON.parse(q.options as unknown as string)
                return (
                    <li
                        key={q.id}
                        className={cn(
                            'rounded-xl border border-white/10 bg-white/5 p-3.5 space-y-2',
                            'hover:border-white/20 hover:bg-white/8 transition-colors cursor-pointer',
                        )}
                    >
                        <p className="text-xs text-zinc-300 leading-snug line-clamp-3 font-medium">
                            {q.content}
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {options.slice(0, 2).map((opt, i) => (
                                <span
                                    key={i}
                                    className="text-[10px] text-zinc-500 bg-white/5 rounded px-1.5 py-0.5 truncate max-w-[120px]"
                                >
                                    {opt}
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
            {[1, 2, 3].map((i) => (
                <RelatedQuestionSkeleton key={i} />
            ))}
        </div>
    )
}
