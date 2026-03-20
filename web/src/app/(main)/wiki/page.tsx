import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Clock, Search } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'

export const metadata: Metadata = {
    title: 'Hippocampus — 知識庫',
    description: '醫學共筆知識庫文章列表',
}

export default async function WikiIndexPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>
}) {
    const { q } = await searchParams
    const searchQuery = q?.trim() ?? ''

    let articles: Array<{
        id: string
        title: string
        status: string
        updatedAt: Date
        _count: { questions: number }
    }> = []

    try {
        articles = await db.wikiArticle.findMany({
            where: {
                deletedAt: null,
                status: 'PUBLISHED',
                ...(searchQuery ? { title: { contains: searchQuery, mode: 'insensitive' as const } } : {}),
            },
            select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                _count: { select: { questions: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
        })
    } catch {
        articles = []
    }

    function titleToSlug(title: string): string {
        return encodeURIComponent(
            title
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^\p{L}\p{N}-]/gu, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, ''),
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Knowledge base"
                title="以閱讀節奏管理醫學條目，而不是把內容塞進卡片牆。"
                description="Wiki 首頁改成偏編輯式索引：先搜尋，再挑選條目，最後進入右側關聯題目的閱讀頁。"
                meta={(
                    <>
                        <span className="pill">{articles.length} 篇文章</span>
                        {searchQuery ? <span className="pill">搜尋：{searchQuery}</span> : null}
                    </>
                )}
            />

            <div className="page-grid-with-rail">
                <div className="space-y-6">
                    <SectionCard title="搜尋條目" description="先縮小閱讀範圍，再進到單篇文章。">
                        <form method="GET" className="relative">
                            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                            <input
                                type="search"
                                name="q"
                                defaultValue={searchQuery}
                                placeholder="搜尋文章標題..."
                                className="input pl-11"
                            />
                        </form>
                    </SectionCard>

                    <SectionCard title="文章索引" description="每篇條目都保留最近更新時間與關聯題量。">
                        {articles.length === 0 ? (
                            <div className="flex min-h-48 items-center justify-center rounded-[24px] border border-dashed border-border-base bg-bg-surface text-sm text-text-muted">
                                {searchQuery ? `沒有找到與「${searchQuery}」相關的文章` : '知識庫目前沒有已發布的文章'}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {articles.map((article) => (
                                    <Link
                                        key={article.id}
                                        href={`/wiki/${titleToSlug(article.title)}`}
                                        className="card card-hoverable flex items-start justify-between gap-4 rounded-[24px] p-5"
                                    >
                                        <div className="min-w-0 space-y-2">
                                            <p className="page-header-eyebrow">Article</p>
                                            <h2 className="font-heading text-xl font-semibold text-text-base">{article.title}</h2>
                                            <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
                                                <span className="inline-flex items-center gap-2">
                                                    <Clock className="size-4" />
                                                    {article.updatedAt.toLocaleDateString('zh-TW')}
                                                </span>
                                                <span>{article._count.questions} 道關聯考題</span>
                                            </div>
                                        </div>
                                        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[18px] bg-primary-muted text-primary-base">
                                            <BookOpen className="size-5" />
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>

                <aside className="page-rail">
                    <SectionCard title="閱讀規則" description="新版知識庫遵循 Notion 式閱讀節奏。">
                        <div className="space-y-3 text-sm leading-7 text-text-muted">
                            <p>左邊是條目與段落，右邊是 contextual rail。</p>
                            <p>當你滾動到不同段落時，右側關聯題目會同步更新，不再停在初始 slug。</p>
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </div>
    )
}
