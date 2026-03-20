'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, History, Play, Settings2, Target, Flame, type LucideIcon } from 'lucide-react'
import { fetchQuizStats } from '@/lib/apiClient'
import { type Tag, type TagDimension, type TagsResponse } from '@/types'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { cn } from '@/lib/cn'

interface QuizDashboardProps {
    tagsData: TagsResponse
}

export function QuizDashboard({ tagsData }: QuizDashboardProps) {
    const router = useRouter()
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [limit, setLimit] = useState<number>(20)
    const [difficulty, setDifficulty] = useState<number | null>(null)

    const { data: stats } = useQuery({
        queryKey: ['quiz-stats'],
        queryFn: fetchQuizStats,
        retry: false,
        staleTime: 60_000,
    })

    function toggleTag(slug: string) {
        setSelectedTags((previous) =>
            previous.includes(slug)
                ? previous.filter((tag) => tag !== slug)
                : [...previous, slug],
        )
    }

    function startQuiz() {
        const params = new URLSearchParams()
        if (selectedTags.length > 0) params.set('tags', selectedTags.join(','))
        if (limit) params.set('limit', limit.toString())
        if (difficulty) params.set('difficulty', difficulty.toString())
        router.push(`/quiz/engine?${params.toString()}`)
    }

    function renderTagGroup(title: string, dimension: TagDimension) {
        const tags = tagsData.grouped[dimension]
        if (!tags || tags.length === 0) return null

        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="font-heading text-lg font-semibold text-text-base">{title}</h3>
                    <span className="text-xs uppercase tracking-[0.24em] text-text-subtle">{tags.length} tags</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {tags.map((tag: Tag) => {
                        const isSelected = selectedTags.includes(tag.slug)
                        return (
                            <button
                                key={tag.slug}
                                type="button"
                                onClick={() => toggleTag(tag.slug)}
                                aria-pressed={isSelected}
                                className={cn(
                                    'rounded-full border px-3 py-2 text-sm font-medium transition-colors',
                                    isSelected
                                        ? 'border-primary-base bg-primary-muted text-text-base'
                                        : 'border-border-base bg-bg-surface text-text-muted hover:border-border-hover hover:bg-surface-muted hover:text-text-base',
                                )}
                            >
                                {tag.name}
                            </button>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Quiz workspace"
                title="先用閱讀式設定頁收斂範圍，再進入沉浸式作答。"
                description="新版 quiz dashboard 保留原本的題數、難度與標籤邏輯，但把它們整理成更像 Notion block 的設定體驗。"
                actions={(
                    <Link href="/quiz/history">
                        <Button variant="secondary" size="sm">
                            <History className="size-4" />
                            作答紀錄
                        </Button>
                    </Link>
                )}
                meta={(
                    <>
                        <span className="pill">已選 {selectedTags.length} 個範圍</span>
                        <span className="pill">題數 {limit}</span>
                        {difficulty ? <span className="pill">難度 {difficulty}</span> : null}
                    </>
                )}
            />

            {stats && stats.totalAttempts > 0 ? (
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                        { label: '正確率', value: `${stats.accuracy}%`, icon: Target, toneClass: 'text-primary-base' },
                        { label: '總作答數', value: String(stats.totalAttempts), icon: BookOpen, toneClass: 'text-secondary-base' },
                        { label: '連對紀錄', value: String(stats.streakCurrent), icon: Flame, toneClass: 'text-warning-base' },
                        { label: '待複習', value: String(stats.dueForReview), icon: History, toneClass: 'text-danger-base' },
                    ].map(({ label, value, icon: Icon, toneClass }: { label: string; value: string; icon: LucideIcon; toneClass: string }) => (
                        <SectionCard key={String(label)} className="space-y-3">
                            <div className={cn('inline-flex size-11 items-center justify-center rounded-[18px] bg-primary-muted', toneClass)}>
                                <Icon className="size-5" />
                            </div>
                            <div>
                                <p className="text-sm text-text-muted">{label}</p>
                                <p className="mt-2 font-heading text-3xl font-bold text-text-base">{value}</p>
                            </div>
                        </SectionCard>
                    ))}
                </section>
            ) : null}

            <SectionCard
                title="測驗設定"
                description="先用 block 方式選題數與難度，接著用標籤收斂題目範圍。"
                actions={(
                    <Button onClick={startQuiz}>
                        <Play className="size-4" />
                        開始測驗
                    </Button>
                )}
            >
                <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 text-sm font-semibold text-text-base">
                                <Settings2 className="size-4 text-primary-base" />
                                測驗題數
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {[10, 20, 50, 100].map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setLimit(value)}
                                        className={cn(
                                            'rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors',
                                            limit === value
                                                ? 'border-primary-base bg-primary-muted text-text-base'
                                                : 'border-border-base bg-bg-surface text-text-muted hover:border-border-hover hover:text-text-base',
                                        )}
                                    >
                                        {value} 題
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <p className="text-sm font-semibold text-text-base">難度篩選</p>
                            <div className="grid grid-cols-5 gap-2">
                                {[1, 2, 3, 4, 5].map((level) => (
                                    <button
                                        key={level}
                                        type="button"
                                        title={`難度 ${level}`}
                                        aria-pressed={difficulty === level}
                                        onClick={() => setDifficulty(difficulty === level ? null : level)}
                                        className={cn(
                                            'rounded-2xl border px-2 py-3 text-center text-sm transition-colors',
                                            difficulty === level
                                                ? 'border-secondary-base bg-secondary-base/15 text-text-base'
                                                : 'border-border-base bg-bg-surface text-text-muted hover:border-border-hover hover:text-text-base',
                                        )}
                                    >
                                        {'★'.repeat(level)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {renderTagGroup('基礎學科', 'ACADEMIC')}
                        {renderTagGroup('臨床系統', 'ORGAN')}
                        {renderTagGroup('考試類別', 'EXAM_CATEGORY')}
                        {renderTagGroup('題型與狀態', 'META')}
                    </div>
                </div>
            </SectionCard>
        </div>
    )
}
