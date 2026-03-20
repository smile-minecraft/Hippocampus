import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
    HydrationBoundary,
    QueryClient,
    dehydrate,
} from '@tanstack/react-query'
import { notFound } from 'next/navigation'
import { ArticleReader } from '@/components/wiki/ArticleReader'
import { RelatedQuestionSkeleton } from '@/components/ui/Skeleton'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { PageHeader } from '@/components/ui/PageHeader'
import { fetchRelatedQuestions, fetchWikiArticle } from '@/lib/apiClient'

interface WikiPageProps {
    params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: WikiPageProps): Promise<Metadata> {
    const { slug } = await params
    return {
        title: slug.replace(/-/g, ' '),
    }
}

export default async function WikiPage({ params }: WikiPageProps) {
    const { slug } = await params

    let article
    try {
        article = await fetchWikiArticle(slug)
    } catch {
        notFound()
    }

    const queryClient = new QueryClient()
    try {
        await queryClient.prefetchQuery({
            queryKey: ['related-questions', slug],
            queryFn: () => fetchRelatedQuestions(slug),
        })
    } catch {
        // Non-fatal; client will retry with the same key.
    }

    const dehydratedState = dehydrate(queryClient)
    const sections = [{ slug, anchor: 'main-content' }]

    return (
        <HydrationBoundary state={dehydratedState}>
            <div className="space-y-6">
                <PageHeader
                    eyebrow="Knowledge article"
                    title={article.title}
                    description="閱讀條目時，右側 contextual rail 會跟著目前段落同步切換，讓知識點與考題回到同一個視窗節奏裡。"
                    meta={(
                        <>
                            <span className="pill">Rose Pine article surface</span>
                            <span className="pill">Context-aware questions</span>
                        </>
                    )}
                />

                <ErrorBoundary>
                    <Suspense
                        fallback={(
                            <div className="page-grid-with-rail">
                                <div className="section-card space-y-4">
                                    {[1, 2, 3].map((item) => (
                                        <div key={item} className="h-4 w-3/4 animate-pulse rounded bg-bg-muted" />
                                    ))}
                                </div>
                                <aside className="page-rail">
                                    <RelatedQuestionSkeleton />
                                </aside>
                            </div>
                        )}
                    >
                        <ArticleReader
                            content={article.content}
                            initialSlug={slug}
                            sections={sections}
                        />
                    </Suspense>
                </ErrorBoundary>
            </div>
        </HydrationBoundary>
    )
}
