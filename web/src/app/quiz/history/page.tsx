'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAttemptHistory, type AttemptRecord } from '@/lib/apiClient'
import { LatexText } from '@/components/ui/LatexText'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import Link from 'next/link'

/**
 * Quiz History page — displays the authenticated user's answer history
 * with pagination and filtering by correctness.
 */
export default function HistoryPage() {
    const [page, setPage] = useState(1)
    const [filterCorrect, setFilterCorrect] = useState<boolean | undefined>(undefined)

    const { data, isLoading, error } = useQuery({
        queryKey: ['attempts', page, filterCorrect],
        queryFn: () => fetchAttemptHistory(page, 20, filterCorrect),
    })

    return (
        <main className="min-h-screen bg-bg-base px-4 py-10 transition-colors duration-300">
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h1 className="text-2xl font-heading font-bold text-text-base">作答紀錄</h1>
                        <p className="text-sm text-text-muted">
                            查看歷次答題記錄與間隔複習狀態
                        </p>
                    </div>
                    <Link href="/quiz">
                        <Button variant="ghost" size="sm">
                            <ChevronLeft className="size-4" />
                            返回題庫
                        </Button>
                    </Link>
                </div>

                {/* Filter bar */}
                <div className="flex items-center gap-2">
                    <Filter className="size-4 text-text-muted" />
                    {([
                        [undefined, '全部'],
                        [true, '答對'],
                        [false, '答錯'],
                    ] as const).map(([value, label]) => (
                        <button
                            key={String(value)}
                            onClick={() => { setFilterCorrect(value); setPage(1) }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                filterCorrect === value
                                    ? 'bg-primary-base text-white'
                                    : 'bg-bg-surface text-text-muted hover:bg-border-base/50'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Loading state */}
                {isLoading && (
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="card p-4 animate-pulse">
                                <div className="h-4 bg-border-base rounded w-3/4" />
                                <div className="h-3 bg-border-base rounded w-1/4 mt-2" />
                            </div>
                        ))}
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="card p-6 text-center text-red-600">
                        載入失敗：{error instanceof Error ? error.message : '未知錯誤'}
                    </div>
                )}

                {/* Records list */}
                {data && (
                    <>
                        {data.records.length === 0 ? (
                            <div className="card p-12 text-center text-text-muted">
                                <p className="text-lg">尚無作答紀錄</p>
                                <p className="text-sm mt-1">前往題庫開始你的第一次練習！</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {data.records.map((record: AttemptRecord) => (
                                    <div key={record.id} className="card px-4 py-3 flex items-center gap-3">
                                        {/* Correct/wrong icon */}
                                        {record.isCorrect ? (
                                            <CheckCircle2 className="size-5 flex-shrink-0 text-cta-base" />
                                        ) : (
                                            <XCircle className="size-5 flex-shrink-0 text-red-500" />
                                        )}

                                        {/* Question stem (truncated) */}
                                        <div className="flex-1 min-w-0">
                                            <LatexText className="text-sm text-text-base truncate block">
                                                {record.question.stem.length > 100
                                                    ? record.question.stem.slice(0, 100) + '…'
                                                    : record.question.stem}
                                            </LatexText>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                                                {record.question.year && (
                                                    <span>{record.question.year} {record.question.examType}</span>
                                                )}
                                                <span>
                                                    你選 {record.userAnswer} / 正確 {record.question.answer}
                                                </span>
                                                <span>
                                                    難度 {'★'.repeat(record.question.difficulty)}{'☆'.repeat(5 - record.question.difficulty)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Spaced repetition info */}
                                        <div className="text-right text-xs text-text-muted flex-shrink-0 space-y-0.5">
                                            <div>
                                                {new Date(record.answeredAt).toLocaleDateString('zh-TW')}
                                            </div>
                                            <div className="font-mono">
                                                {record.repetitions > 0
                                                    ? `連對 ${record.repetitions}次`
                                                    : '待複習'
                                                }
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Pagination */}
                        {data.pagination.totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 pt-4">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="size-4" />
                                    上一頁
                                </Button>
                                <span className="text-sm text-text-muted font-mono">
                                    {page} / {data.pagination.totalPages}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page >= data.pagination.totalPages}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    下一頁
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    )
}
