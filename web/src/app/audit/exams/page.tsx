'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAdminExams, deleteAdminExam, type ExamSummary } from '@/lib/apiClient'
import { TopNav } from '@/components/ui/TopNav'
import { Loader2, Trash2, FolderEdit } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

export default function ExamsAdminPage() {
    const queryClient = useQueryClient()
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const { data: exams, isLoading, error } = useQuery<ExamSummary[]>({
        queryKey: ['admin-exams'],
        queryFn: fetchAdminExams,
        staleTime: 1000 * 60 * 5, // 5 mins
    })

    const deleteMutation = useMutation({
        mutationFn: ({ year, examType }: { year: number | null, examType: string | null }) => {
            if (!year || !examType) return Promise.reject(new Error('遺失必要參數'))
            return deleteAdminExam(year, examType)
        },
        onMutate: async ({ year, examType }) => {
            // Optimistic Update: Remove it from UI instantly
            await queryClient.cancelQueries({ queryKey: ['admin-exams'] })
            const previous = queryClient.getQueryData<ExamSummary[]>(['admin-exams'])

            if (previous) {
                queryClient.setQueryData<ExamSummary[]>(['admin-exams'], old =>
                    old?.filter(e => !(e.year === year && e.examType === examType))
                )
            }
            return { previous }
        },
        onError: (err, variables, context: any) => {
            // Revert on failure
            if (context?.previous) {
                queryClient.setQueryData(['admin-exams'], context.previous)
            }
            alert(`刪除失敗: ${err.message}`)
            setDeletingId(null)
        },
        onSettled: () => {
            // Refetch to ensure sync
            queryClient.invalidateQueries({ queryKey: ['admin-exams'] })
            setDeletingId(null)
        }
    })

    const handleDelete = (exam: ExamSummary) => {
        if (!exam.year || !exam.examType) {
            alert('此考卷缺少關閉參數，無法整卷刪除。請進入單卷編輯單題刪除。')
            return
        }

        if (confirm(`確定要刪除「${exam.year} ${exam.examType}」整份考卷嗎？\n(這會將 ${exam.questionCount} 題標記為已刪除，但保留刷題歷史)`)) {
            setDeletingId(`${exam.year}-${exam.examType}`)
            deleteMutation.mutate({ year: exam.year, examType: exam.examType })
        }
    }

    return (
        <>
            <TopNav />
            <main className="min-h-screen bg-bg-base px-4 py-6 transition-colors duration-300">
                <div className="max-w-5xl mx-auto space-y-6">
                    <header className="flex justify-between items-center space-y-1">
                        <div>
                            <h1 className="text-2xl font-heading font-bold text-text-base">
                                題庫管理中心
                            </h1>
                            <p className="text-sm text-text-muted mt-1">
                                您可以在此檢視、刪除或重新分配批次考卷
                            </p>
                        </div>
                        <Link
                            href="/audit"
                            className="text-sm font-medium text-primary-base hover:underline"
                        >
                            ← 返回審核工作站
                        </Link>
                    </header>

                    {isLoading ? (
                        <div className="flex justify-center items-center py-20 text-text-muted">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <span className="ml-3">載入題庫中...</span>
                        </div>
                    ) : error ? (
                        <div className="bg-red-500/10 text-red-500 p-4 rounded-xl border border-red-500/20">
                            載入失敗: {(error as Error).message}
                        </div>
                    ) : !exams || exams.length === 0 ? (
                        <div className="border-2 border-dashed border-border-base rounded-2xl flex flex-col items-center justify-center py-24 text-text-muted">
                            <FolderEdit className="w-12 h-12 mb-4 text-border-base" />
                            <p>系統內尚無活躍的題庫考卷</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {exams.map((exam, i) => {
                                const idKey = `${exam.year}-${exam.examType}`;
                                const isDeleting = deletingId === idKey;

                                return (
                                    <div
                                        key={idKey + i}
                                        className={`bg-bg-surface border border-border-base rounded-xl p-5 shadow-sm transition-all flex flex-col justify-between
                                            ${isDeleting ? 'opacity-50 pointer-events-none' : 'hover:border-primary-base hover:shadow-md'}`}
                                    >
                                        <div className="mb-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary-muted text-primary-base">
                                                    {exam.year || '未知年份'}
                                                </span>
                                            </div>
                                            <h3 className="font-heading font-bold text-lg text-text-base mb-1 line-clamp-2">
                                                {exam.examType || '未分類考卷'}
                                            </h3>
                                            <p className="text-sm text-text-muted">包含 {exam.questionCount} 題</p>
                                        </div>

                                        <div className="flex gap-2 pt-4 border-t border-border-base">
                                            <Link
                                                href={`/audit/exams/${exam.year}_${encodeURIComponent(exam.examType || 'NONE')}`}
                                                className="flex-1 text-center py-2 bg-primary-base/10 hover:bg-primary-base hover:text-white text-primary-base font-medium rounded-lg transition-colors text-sm"
                                            >
                                                查閱編輯
                                            </Link>
                                            <button
                                                onClick={() => handleDelete(exam)}
                                                disabled={isDeleting}
                                                className="p-2 text-text-muted hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
                                                title="整卷刪除"
                                            >
                                                {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </main>
        </>
    )
}
