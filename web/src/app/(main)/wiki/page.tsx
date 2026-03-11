import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { BookOpen, Search, Clock } from 'lucide-react'

export const metadata: Metadata = {
    title: 'Hippocampus — 知識庫',
    description: '醫學共筆知識庫文章列表',
}

/**
 * Wiki index page — Server Component.
 * Lists all published wiki articles from the database with search.
 * Falls back gracefully if DB is empty or unavailable.
 */
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
                ...(searchQuery
                    ? { title: { contains: searchQuery, mode: 'insensitive' as const } }
                    : {}),
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
        // DB unavailable — render empty state
    }

    // Generate a URL-safe slug from article title
    function titleToSlug(title: string): string {
        return encodeURIComponent(
            title
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^\p{L}\p{N}-]/gu, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
        )
    }

    return (
        <main className="min-h-screen bg-bg-base px-4 py-8 md:py-12">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <header className="space-y-2">
                    <h1 className="text-3xl font-heading font-bold text-text-base tracking-tight flex items-center gap-3">
                        <BookOpen className="size-8 text-primary-base" />
                        知識庫
                    </h1>
                    <p className="text-text-muted">
                        醫學共筆知識條目，點擊文章可查看內容與關聯考題
                    </p>
                </header>

                {/* Search */}
                <form method="GET" className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
                    <input
                        type="search"
                        name="q"
                        defaultValue={searchQuery}
                        placeholder="搜尋文章標題..."
                        className="w-full bg-bg-surface border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-primary-base focus:ring-1 focus:ring-primary-base transition-all"
                    />
                </form>

                {/* Results */}
                {articles.length === 0 ? (
                    <div className="text-center py-16 space-y-3">
                        <BookOpen className="size-12 text-text-muted/30 mx-auto" />
                        <p className="text-text-muted">
                            {searchQuery
                                ? `沒有找到與「${searchQuery}」相關的文章`
                                : '知識庫目前沒有已發布的文章'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-text-muted">
                            共 {articles.length} 篇文章
                            {searchQuery && `（搜尋：${searchQuery}）`}
                        </p>
                        <div className="grid gap-3">
                            {articles.map((article) => (
                                <Link
                                    key={article.id}
                                    href={`/wiki/${titleToSlug(article.title)}`}
                                    className="card card-hoverable p-5 flex items-center justify-between gap-4 group"
                                >
                                    <div className="min-w-0 space-y-1">
                                        <h2 className="font-medium text-text-base group-hover:text-primary-base transition-colors truncate">
                                            {article.title}
                                        </h2>
                                        <div className="flex items-center gap-3 text-xs text-text-muted">
                                            <span className="flex items-center gap-1">
                                                <Clock className="size-3" />
                                                {article.updatedAt.toLocaleDateString('zh-TW')}
                                            </span>
                                            {article._count.questions > 0 && (
                                                <span>{article._count.questions} 道關聯考題</span>
                                            )}
                                        </div>
                                    </div>
                                    <BookOpen className="size-5 text-text-muted/50 group-hover:text-primary-base transition-colors flex-shrink-0" />
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}
