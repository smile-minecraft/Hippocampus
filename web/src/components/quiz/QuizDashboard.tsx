'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { fetchQuizStats } from '@/lib/apiClient'
import { TagsResponse, Tag, TagDimension } from '@/types'
import { Play, Settings2, History, Target, Flame, BookOpen } from 'lucide-react'
import Link from 'next/link'

interface QuizDashboardProps {
    tagsData: TagsResponse
}

export function QuizDashboard({ tagsData }: QuizDashboardProps) {
    const router = useRouter()
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [limit, setLimit] = useState<number>(20)
    const [difficulty, setDifficulty] = useState<number | null>(null)

    // Fetch user stats (graceful — renders without stats if user is not authenticated)
    const { data: stats } = useQuery({
        queryKey: ['quiz-stats'],
        queryFn: fetchQuizStats,
        retry: false,
        staleTime: 60_000,
    })

    const toggleTag = (slug: string) => {
        setSelectedTags(prev =>
            prev.includes(slug) ? prev.filter(t => t !== slug) : [...prev, slug]
        )
    }

    const startQuiz = () => {
        const params = new URLSearchParams()
        if (selectedTags.length > 0) params.set('tags', selectedTags.join(','))
        if (limit) params.set('limit', limit.toString())
        if (difficulty) params.set('difficulty', difficulty.toString())

        router.push(`/quiz/engine?${params.toString()}`)
    }

    // Render tag groups safely based on dimension keys
    const renderTagGroup = (title: string, dimension: TagDimension) => {
        const tags = tagsData.grouped[dimension]
        if (!tags || tags.length === 0) return null

        return (
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-muted px-1">{title}</h3>
                <div className="flex flex-wrap gap-2">
                    {tags.map((tag: Tag) => {
                        const isSelected = selectedTags.includes(tag.slug)
                        return (
                            <button
                                key={tag.slug}
                                onClick={() => toggleTag(tag.slug)}
                                className={`
                                    px-3 py-1.5 text-sm font-medium rounded-full transition-all duration-200 border
                                    ${isSelected
                                        ? 'bg-primary-base/10 text-primary-base border-primary-base/30 shadow-sm'
                                        : 'bg-bg-subtle text-text-base border-border-base hover:border-border-hover hover:bg-bg-muted'}
                                `}
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
        <div className="w-full max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="space-y-2">
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-heading font-bold text-text-base tracking-tight flex items-center gap-2">
                        <Settings2 className="size-7 text-primary-base" />
                        自訂測驗
                    </h1>
                    <Link href="/quiz/history">
                        <Button variant="ghost" size="sm">
                            <History className="size-4" />
                            作答紀錄
                        </Button>
                    </Link>
                </div>
                <p className="text-text-muted">選擇你想要複習的範圍與題數設定，系統將動態為你組出最佳的試卷。</p>
            </header>

            {/* Personal stats summary */}
            {stats && stats.totalAttempts > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="card p-4 text-center space-y-1">
                        <Target className="size-5 mx-auto text-primary-base" />
                        <div className="text-2xl font-bold font-mono text-text-base">{stats.accuracy}%</div>
                        <div className="text-xs text-text-muted">正確率</div>
                    </div>
                    <div className="card p-4 text-center space-y-1">
                        <BookOpen className="size-5 mx-auto text-primary-base" />
                        <div className="text-2xl font-bold font-mono text-text-base">{stats.totalAttempts}</div>
                        <div className="text-xs text-text-muted">總作答數</div>
                    </div>
                    <div className="card p-4 text-center space-y-1">
                        <Flame className="size-5 mx-auto text-amber-500" />
                        <div className="text-2xl font-bold font-mono text-text-base">{stats.streakCurrent}</div>
                        <div className="text-xs text-text-muted">連對紀錄</div>
                    </div>
                    <div className="card p-4 text-center space-y-1">
                        <History className="size-5 mx-auto text-red-500" />
                        <div className="text-2xl font-bold font-mono text-text-base">{stats.dueForReview}</div>
                        <div className="text-xs text-text-muted">待複習</div>
                    </div>
                </div>
            )}

            <section className="card p-6 md:p-8 space-y-8 bg-surface-base shadow-sm border border-border-base">

                {/* 題數與難度設定 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-text-muted">測驗題數</h3>
                        <div className="flex items-center gap-3">
                            {[10, 20, 50, 100].map(n => (
                                <button
                                    key={n}
                                    onClick={() => setLimit(n)}
                                    className={`
                                        flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
                                        ${limit === n
                                            ? 'bg-text-base text-bg-base border-text-base'
                                            : 'bg-transparent text-text-muted border-border-base hover:border-text-muted'}
                                    `}
                                >
                                    {n} 題
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-text-muted">難度篩選 (選填)</h3>
                        <div className="flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map(level => (
                                <button
                                    key={level}
                                    onClick={() => setDifficulty(difficulty === level ? null : level)}
                                    className={`
                                        flex-1 py-2 flex justify-center items-center rounded-lg text-sm transition-colors border
                                        ${difficulty === level
                                            ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                            : 'bg-transparent text-text-muted border-border-base hover:border-text-muted'}
                                    `}
                                    title={`難度 ${level}`}
                                >
                                    {'★'.repeat(level)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="divider" />

                {/* 標籤過濾區域 */}
                <div className="space-y-6">
                    {renderTagGroup('基礎學科', 'ACADEMIC')}
                    {renderTagGroup('臨床系統', 'ORGAN')}
                    {renderTagGroup('考試類別', 'EXAM_CATEGORY')}
                    {renderTagGroup('題型與狀態', 'META')}
                </div>
            </section>

            {/* 底部按鈕 */}
            <motion.div
                className="flex items-center justify-between sticky bottom-6 p-4 rounded-2xl bg-surface-base/80 backdrop-blur border border-border-default shadow-lg"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
            >
                <div className="text-sm text-text-muted font-medium">
                    已選擇 <span className="font-bold text-primary-base">{selectedTags.length}</span> 個範圍，共 <span className="font-bold text-text-base">{limit}</span> 題
                </div>
                <Button
                    size="lg"
                    className="shadow-sm font-bold tracking-wide"
                    onClick={startQuiz}
                >
                    <Play className="size-4 fill-current mr-1" />
                    開始測驗
                </Button>
            </motion.div>
        </div>
    )
}
