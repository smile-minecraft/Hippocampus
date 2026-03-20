'use client'

import { startTransition, useState, type RefObject } from 'react'
import { useIntersectionTracker } from './useIntersectionTracker'
import { RelatedQuestions } from './RelatedQuestions'

interface ArticleReaderProps {
    content: string
    initialSlug: string
    sections: Array<{ slug: string; anchor: string }>
}

export function ArticleReader({ content, initialSlug, sections }: ArticleReaderProps) {
    const [activeSlug, setActiveSlug] = useState(initialSlug)

    const { rootRef } = useIntersectionTracker({
        onSectionChange: (slug) => {
            startTransition(() => {
                setActiveSlug(slug)
            })
        },
    })

    return (
        <div className="page-grid-with-rail">
            <article
                ref={rootRef as RefObject<HTMLElement>}
                className="editor-prose min-w-0 rounded-[30px] border border-border-base bg-surface-base px-6 py-8 shadow-elevation-1 backdrop-blur-xl md:px-10"
                aria-label="知識條目內容"
            >
                {sections.map(({ slug, anchor }) => (
                    <section
                        key={slug}
                        data-slug={slug}
                        id={anchor}
                        className="scroll-mt-20"
                    />
                ))}
                <div dangerouslySetInnerHTML={{ __html: content }} />
            </article>

            <aside className="page-rail">
                <section className="section-card py-4">
                    <div className="border-b border-border-base px-4 pb-3">
                        <p className="page-header-eyebrow">Context rail</p>
                        <h2 className="font-heading text-lg font-semibold text-text-base">關聯考古題</h2>
                    </div>
                    <div className="pt-3">
                        <RelatedQuestions activeSlug={activeSlug} />
                    </div>
                </section>
            </aside>
        </div>
    )
}
