import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
    HydrationBoundary,
    QueryClient,
    dehydrate,
} from '@tanstack/react-query'
import { ArticleReader } from '@/components/wiki/ArticleReader'
import { RelatedQuestionSkeleton } from '@/components/ui/Skeleton'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { fetchWikiArticle, fetchRelatedQuestions } from '@/lib/apiClient'
import { notFound } from 'next/navigation'

interface WikiPageProps {
    params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: WikiPageProps): Promise<Metadata> {
    const { slug } = await params
    return {
        title: slug.replace(/-/g, ' '),
    }
}

/**
 * Wiki article page — Server Component with TanStack Query dehydration.
 *
 * SSR prefetch strategy:
 *   1. Fetch the article content on the server (always fresh, not cached at edge)
 *   2. Prefetch related questions for the FIRST section slug into QueryClient
 *   3. Dehydrate the QueryClient and pass to HydrationBoundary
 *   → Client-side RelatedQuestions gets instant cache hit on first render (zero skeleton)
 *   → Subsequent section changes trigger normal TanStack Query fetches
 *
 * graceful degradation: if either API call fails, page still renders with available data.
 */
export default async function WikiPage({ params }: WikiPageProps) {
    const { slug } = await params

    // Fetch article
    let article
    try {
        article = await fetchWikiArticle(slug)
    } catch {
        notFound()
    }

    // Prefetch related questions for the first section into dehydrated state
    const queryClient = new QueryClient()
    try {
        await queryClient.prefetchQuery({
            queryKey: ['related-questions', slug],
            queryFn: () => fetchRelatedQuestions(slug),
        })
    } catch {
        // Non-fatal — client will fetch on demand
    }

    const dehydratedState = dehydrate(queryClient)

    // Build section list from article headings (simplified: treat whole article as one section)
    const sections = [{ slug, anchor: 'main-content' }]

    return (
        <HydrationBoundary state={dehydratedState}>
            <main className="min-h-screen bg-zinc-950 px-4 py-10">
                <div className="max-w-7xl mx-auto">
                    <header className="mb-8 space-y-1 max-w-2xl">
                        <h1 className="text-3xl font-bold text-zinc-100">{article.title}</h1>
                    </header>

                    <ErrorBoundary>
                        <Suspense
                            fallback={
                                <div className="flex gap-8">
                                    <div className="flex-1 space-y-4 animate-pulse">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="h-4 bg-white/10 rounded w-3/4" />
                                        ))}
                                    </div>
                                    <aside className="w-80 hidden lg:block">
                                        <RelatedQuestionSkeleton />
                                    </aside>
                                </div>
                            }
                        >
                            <ArticleReader
                                content={article.content}
                                initialSlug={slug}
                                sections={sections}
                            />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </main>
        </HydrationBoundary>
    )
}
