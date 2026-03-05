'use client'

import { useRef, useCallback } from 'react'
import { useIntersectionTracker } from './useIntersectionTracker'
import { RelatedQuestions } from './RelatedQuestions'

interface ArticleReaderProps {
    content: string          // Rendered HTML sections (from Markdown)
    initialSlug: string      // Slug of the first section (for SSR prefetch align)
    sections: Array<{ slug: string; anchor: string }>
}

/**
 * Two-pane article reading interface.
 *
 * Left: article content, each <section data-slug> observed by IntersectionObserver
 * Right: RelatedQuestions sidebar, updated via non-urgent useTransition
 *
 * The RelatedQuestions component exposes a static `_updateSlug` ref so
 * ArticleReader can trigger updates without prop drilling or shared context.
 */
export function ArticleReader({ content, initialSlug, sections }: ArticleReaderProps) {
    // no relatedRef needed — updateSlug is wired via static _updateSlug ref on the component

    const handleSectionChange = useCallback((slug: string) => {
        // Trigger the non-urgent transition inside RelatedQuestions
        const updater = (RelatedQuestions as unknown as { _updateSlug?: (s: string) => void })._updateSlug
        updater?.(slug)
    }, [])

    const { rootRef } = useIntersectionTracker({ onSectionChange: handleSectionChange })

    return (
        <div className="flex gap-8 min-h-screen">
            {/* Left: Article content */}
            <article
                ref={rootRef as React.RefObject<HTMLElement>}
                className="flex-1 min-w-0 prose prose-invert prose-zinc max-w-none"
                aria-label="知識條目內容"
            >
                {sections.map(({ slug, anchor }) => (
                    <section
                        key={slug}
                        data-slug={slug}
                        id={anchor}
                        className="scroll-mt-20"
                    >
                        {/* Content is pre-rendered by the Server Component */}
                    </section>
                ))}
                {/* Fallback: render raw content if no section breakdown */}
                <div dangerouslySetInnerHTML={{ __html: content }} />
            </article>

            {/* Right: Related questions sidebar */}
            <aside
                className="hidden lg:block w-80 xl:w-96 flex-shrink-0 sticky top-20 self-start max-h-[calc(100vh-5rem)] overflow-y-auto"
                aria-label="關聯考古題"
            >
                <div className="rounded-2xl border border-white/10 bg-white/5 py-4">
                    <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 pb-3 border-b border-white/10">
                        相關歷屆考題
                    </h2>
                    <div className="pt-3">
                        <RelatedQuestions initialSlug={initialSlug} />
                    </div>
                </div>
            </aside>
        </div>
    )
}
