'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAdminExams, deleteAdminExam, type ExamSummary } from '@/lib/apiClient'
import { Loader2, Trash2, FolderEdit } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { useFeedback } from '@/components/ui/FeedbackProvider'

export default function ExamsAdminPage() {
    const queryClient = useQueryClient()
    const { confirm, notify } = useFeedback()
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
        onError: (err, _variables, context) => {
            const ctx = context as { previous?: ExamSummary[] } | undefined;
            // Revert on failure
            if (ctx?.previous) {
                queryClient.setQueryData(['admin-exams'], ctx.previous);
            }
            notify({
                tone: 'error',
                title: '刪除失敗',
                description: err.message,
            })
            setDeletingId(null)
        },
        onSettled: () => {
            // Refetch to ensure sync
            queryClient.invalidateQueries({ queryKey: ['admin-exams'] })
            setDeletingId(null)
        }
    })

    const handleDelete = async (exam: ExamSummary) => {
        if (!exam.year || !exam.examType) {
            notify({
                tone: 'warning',
                title: '缺少必要參數',
                description: '此考卷缺少關閉參數，無法整卷刪除。請進入單卷編輯單題刪除。',
            })
            return
        }

        const accepted = await confirm({
            title: `刪除「${exam.year} ${exam.examType}」整份考卷？`,
            description: `這會將 ${exam.questionCount} 題標記為已刪除，但保留刷題歷史。`,
            confirmLabel: '刪除考卷',
            tone: 'danger',
        })

        if (!accepted) return

        setDeletingId(`${exam.year}-${exam.examType}`)
        deleteMutation.mutate({ year: exam.year, examType: exam.examType })
    }

    return (
        <div className="space-y-6">
                <PageHeader
                    eyebrow="Audit exams"
                    title="用編輯式索引管理整卷題目。"
                    description="這裡保留卷級視角，適合先看批次結構，再進到單卷頁面處理題目細節。"
                    actions={(
                        <Link href="/audit" className="text-sm font-medium text-primary-base transition-colors hover:text-primary-hover">
                            返回審核工作站
                        </Link>
                    )}
                />

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
                        <SectionCard className="border-dashed text-center">
                            <FolderEdit className="w-12 h-12 mb-4 text-border-base" />
                            <p>系統內尚無活躍的題庫考卷</p>
                        </SectionCard>
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
    )
}
