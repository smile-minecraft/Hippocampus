'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAdminExamQuestions, bulkDeleteQuestions, bulkTransferQuestions, updateQuestionTags, batchUpdateQuestionTags } from '@/lib/apiClient'
import { useQuestionSelection } from '@/lib/stores/useQuestionSelection'
import { Loader2, Trash2, ArrowRightLeft, Square, CheckSquare, Pencil, X, Sparkles, Tags, Tag, Plus, Minus } from 'lucide-react'
import Link from 'next/link'
import { useState, useMemo } from 'react'
import { updateAdminQuestion, deleteAdminQuestion, type Question } from '@/lib/apiClient'
import { LatexText } from '@/components/ui/LatexText'
import { GroupedTagMultiSelect } from '@/components/quiz/GroupedTagMultiSelect'
import { formatQuestion } from '@/lib/validation/question-formatter'

function getCsrfToken(): string {
    if (typeof document === 'undefined') return ''
    const match = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
    return match ? match[1] : ''
}

export default function ExamDetailPage() {
    const params = useParams()
    const queryClient = useQueryClient()
    const id = params.id as string

    // Parse the display name from URL (year_examType)
    const [yearStr, ...examTypeParts] = id.split("_")
    const examType = decodeURIComponent(examTypeParts.join("_"))
    const title = `${yearStr} ${examType === 'NONE' ? '未分類' : examType}`

    // Fetch Questions
    const { data: questions, isLoading } = useQuery({
        queryKey: ['admin-exams', id],
        queryFn: () => fetchAdminExamQuestions(id),
        select: (data) => {
            // Format questions to extract any embedded options from stems
            return data.map(q => {
                const result = formatQuestion({
                    stem: q.stem,
                    options: typeof q.options === 'string'
                        ? (JSON.parse(q.options) as Record<string, string>)
                        : q.options,
                    explanation: q.explanation,
                })
                return {
                    ...q,
                    stem: result.question.stem,
                    options: result.question.options,
                    explanation: result.question.explanation ?? null,
                }
            })
        },
    })

    // Zustand bulk selection state
    const { selectedIds, toggleSelection, selectAll, clearSelection } = useQuestionSelection()
    const selectedCount = selectedIds.size

    const isAllSelected = useMemo(() => {
        if (!questions || questions.length === 0) return false
        return questions.every(q => selectedIds.has(q.id))
    }, [questions, selectedIds])

    const handleToggleAll = () => {
        if (isAllSelected) {
            clearSelection()
        } else {
            if (questions) selectAll(questions.map(q => q.id))
        }
    }

    // Modal State
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
    const [transferYear, setTransferYear] = useState<string>('')
    const [transferExamType, setTransferExamType] = useState<string>('')

    // Batch Tag Modal State
    const [isBatchTagModalOpen, setIsBatchTagModalOpen] = useState(false)
    const [batchTagMode, setBatchTagMode] = useState<'add' | 'remove'>('add')
    const [selectedTagSlugsForBatch, setSelectedTagSlugsForBatch] = useState<string[]>([])

    // Individual Edit/Delete State
    const [editingQuestion, setEditingQuestion] = useState<Question | null>(null)

    // Bulk Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: (ids: string[]) => bulkDeleteQuestions(ids),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
            queryClient.invalidateQueries({ queryKey: ['admin-exams'] }) // Also invalidate list view
            clearSelection()
            alert('刪除成功')
        },
        onError: (err) => alert(`刪除失敗: ${err.message}`)
    })

    // Bulk Transfer Mutation 
    const transferMutation = useMutation({
        mutationFn: () => bulkTransferQuestions({
            questionIds: Array.from(selectedIds),
            newYear: transferYear ? parseInt(transferYear, 10) : undefined,
            newExamType: transferExamType || undefined
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
            queryClient.invalidateQueries({ queryKey: ['admin-exams'] })
            clearSelection()
            setIsTransferModalOpen(false)
            alert('轉移成功')
        },
        onError: (err) => alert(`轉移失敗: ${err.message}`)
    })

    const updateMutation = useMutation({
        mutationFn: (vars: { id: string, payload: Partial<Question> }) => updateAdminQuestion(vars.id, vars.payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
            setEditingQuestion(null)
        },
        onError: (err) => alert(`更新失敗: ${err.message}`)
    })

    const individualDeleteMutation = useMutation({
        mutationFn: (questionId: string) => deleteAdminQuestion(questionId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
            alert('題目已刪除')
        },
        onError: (err) => alert(`刪除失敗: ${err.message}`)
    })

    const updateTagsMutation = useMutation({
        mutationFn: (vars: { questionId: string; add: string[]; remove: string[] }) => updateQuestionTags(vars.questionId, { add: vars.add, remove: vars.remove }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
        },
        onError: (err) => alert(`標籤更新失敗: ${err.message}`)
    })

    const batchUpdateTagsMutation = useMutation({
        mutationFn: () => batchUpdateQuestionTags({
            questionIds: Array.from(selectedIds),
            add: batchTagMode === 'add' ? selectedTagSlugsForBatch : [],
            remove: batchTagMode === 'remove' ? selectedTagSlugsForBatch : [],
        }),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['admin-exams', id] })
            clearSelection()
            setIsBatchTagModalOpen(false)
            setSelectedTagSlugsForBatch([])
            alert(`${batchTagMode === 'add' ? '添加' : '移除'}標籤成功，共影響 ${data.affectedCount} 題`)
        },
        onError: (err) => alert(`批量標籤操作失敗: ${err.message}`)
    })

    const handleBulkDelete = () => {
        if (selectedCount === 0) return
        if (confirm(`確定要刪除這 ${selectedCount} 題嗎？`)) {
            deleteMutation.mutate(Array.from(selectedIds))
        }
    }

    const handleBulkTransferSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!transferYear && !transferExamType) {
            alert("請至少輸入新年份或新分類名稱")
            return
        }
        transferMutation.mutate()
    }

    return (
        <>
            <main className="min-h-screen bg-bg-base px-4 py-6 transition-colors duration-300">
                <div className="max-w-6xl mx-auto space-y-6">
                    <header className="flex justify-between items-center space-y-1">
                        <div>
                            <h1 className="text-2xl font-heading font-bold text-text-base">
                                題庫明細: {title}
                            </h1>
                            <p className="text-sm text-text-muted mt-1">
                                已選取 {selectedCount} 題
                            </p>
                        </div>
                        <div className="flex gap-4 items-center">
                            {selectedCount > 0 && (
                                <div className="flex gap-2 animate-in fade-in slide-in-from-right-4">
                                    <button
                                        onClick={() => {
                                            setBatchTagMode('add')
                                            setSelectedTagSlugsForBatch([])
                                            setIsBatchTagModalOpen(true)
                                        }}
                                        className="inline-flex items-center px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        批量添加標籤
                                    </button>
                                    <button
                                        onClick={() => {
                                            setBatchTagMode('remove')
                                            setSelectedTagSlugsForBatch([])
                                            setIsBatchTagModalOpen(true)
                                        }}
                                        className="inline-flex items-center px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        <Minus className="w-4 h-4 mr-2" />
                                        批量移除標籤
                                    </button>
                                    <button
                                        onClick={() => setIsTransferModalOpen(true)}
                                        className="inline-flex items-center px-3 py-2 bg-primary-base hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                                    >
                                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                                        分割 / 轉移卷別
                                    </button>
                                    <button
                                        onClick={handleBulkDelete}
                                        disabled={deleteMutation.isPending}
                                        className="inline-flex items-center px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                        批次刪除
                                    </button>
                                </div>
                            )}
                            <Link
                                href="/audit/exams"
                                className="text-sm font-medium text-text-muted hover:text-primary-base"
                            >
                                ← 返回題庫列表
                            </Link>
                        </div>
                    </header>

                    {isLoading ? (
                        <div className="flex justify-center items-center py-20 text-text-muted">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <span className="ml-3">載入題目中...</span>
                        </div>
                    ) : questions?.length === 0 ? (
                        <div className="border-2 border-dashed border-border-base rounded-2xl flex flex-col items-center justify-center py-24 text-text-muted">
                            <p>此考卷內尚無題目，或皆已被軟刪除</p>
                        </div>
                    ) : (
                        <div className="bg-bg-surface border border-border-base rounded-xl overflow-hidden shadow-sm">
                            <div className="flex items-center p-4 border-b border-border-base bg-bg-base/50">
                                <button onClick={handleToggleAll} className="mr-4 text-text-muted hover:text-primary-base">
                                    {isAllSelected ? <CheckSquare className="w-5 h-5 text-primary-base" /> : <Square className="w-5 h-5" />}
                                </button>
                                <span className="text-sm font-medium text-text-base">全選 / 取消全選</span>
                            </div>
                            <div className="divide-y divide-border-base">
                                {questions?.map((q, idx) => (
                                    <div
                                        key={q.id}
                                        className={`p-4 flex gap-4 transition-colors ${selectedIds.has(q.id) ? 'bg-primary-base/5' : 'hover:bg-bg-base/50'}`}
                                        onClick={() => toggleSelection(q.id)}
                                    >
                                        <button className="mt-1 text-text-muted shrink-0">
                                            {selectedIds.has(q.id) ? <CheckSquare className="w-5 h-5 text-primary-base" /> : <Square className="w-5 h-5" />}
                                        </button>
                                        <div className="flex-1 cursor-pointer">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-mono text-text-muted">#{idx + 1}</span>
                                                    {q.difficulty !== undefined && q.difficulty !== null ? (
                                                        <span className="text-xs text-text-muted">
                                                            難度 {'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-text-muted">難度 未設定</span>
                                                    )}
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingQuestion(q); }}
                                                        className="p-1.5 hover:bg-primary-base/10 text-text-muted hover:text-primary-base rounded-lg transition-colors"
                                                        title="編輯題目內容"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm('確定要刪除此題目嗎？')) individualDeleteMutation.mutate(q.id);
                                                        }}
                                                        className="p-1.5 hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded-lg transition-colors"
                                                        title="刪除此題"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="text-sm text-text-base line-clamp-2 prose dark:prose-invert max-w-none">
                                                <LatexText>{q.stem}</LatexText>
                                            </div>
                                            <div className="mt-2 flex gap-1 items-center overflow-hidden">
                                                {Object.entries(q.options as Record<string, string>).map(([key, val]) => (
                                                    <span key={key} className={`px-2 py-0.5 rounded text-[10px] truncate max-w-[120px] border ${q.answer === key ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'bg-bg-base border-border-base text-text-muted'}`}>
                                                        {key}. {val}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Transfer Modal */}
            {isTransferModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-bg-surface w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 p-6 space-y-6">
                        <header>
                            <h2 className="text-lg font-heading font-bold text-text-base">轉移 {selectedCount} 題至新考卷</h2>
                            <p className="text-sm text-text-muted mt-1">留白表示維持原屬性不變</p>
                        </header>

                        <form onSubmit={handleBulkTransferSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-base">分配至新年份 (Year)</label>
                                <input
                                    type="number"
                                    placeholder="例如: 2024"
                                    value={transferYear}
                                    onChange={e => setTransferYear(e.target.value)}
                                    className="w-full px-4 py-2 border border-border-base rounded-lg bg-bg-base text-text-base focus:ring-2 focus:ring-primary-base outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-base">分配至新分類 (Exam Type)</label>
                                <input
                                    type="text"
                                    placeholder="例如: 國考"
                                    value={transferExamType}
                                    onChange={e => setTransferExamType(e.target.value)}
                                    className="w-full px-4 py-2 border border-border-base rounded-lg bg-bg-base text-text-base focus:ring-2 focus:ring-primary-base outline-none transition-all"
                                />
                            </div>

                            <div className="pt-4 flex gap-3 justify-end border-t border-border-base">
                                <button
                                    type="button"
                                    onClick={() => setIsTransferModalOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-base transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={transferMutation.isPending}
                                    className="px-4 py-2 bg-primary-base hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center"
                                >
                                    {transferMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    確認轉移
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Batch Tag Modal */}
            {isBatchTagModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-bg-surface w-full max-w-lg rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95">
                        <header className="p-4 border-b border-border-base flex justify-between items-center bg-bg-base/50">
                            <div className="flex items-center gap-2">
                                <Tag className={`w-5 h-5 ${batchTagMode === 'add' ? 'text-emerald-500' : 'text-amber-500'}`} />
                                <h2 className="text-lg font-heading font-bold text-text-base">
                                    {batchTagMode === 'add' ? '批量添加標籤' : '批量移除標籤'}
                                </h2>
                            </div>
                            <button
                                onClick={() => {
                                    setIsBatchTagModalOpen(false)
                                    setSelectedTagSlugsForBatch([])
                                }}
                                className="p-2 hover:bg-bg-base rounded-full text-text-muted transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </header>

                        <div className="p-4 space-y-4">
                            <p className="text-sm text-text-muted">
                                已選取 <span className="font-medium text-text-base">{selectedCount}</span> 題，
                                請選擇要{batchTagMode === 'add' ? '添加' : '移除'}的標籤：
                            </p>

                            <GroupedTagMultiSelect
                                selectedSlugs={selectedTagSlugsForBatch}
                                onChange={setSelectedTagSlugsForBatch}
                                className="max-h-[400px]"
                            />

                            {selectedTagSlugsForBatch.length > 0 && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-text-muted">已選擇標籤:</span>
                                    <span className="font-medium text-text-base">{selectedTagSlugsForBatch.length}</span>
                                    <span className="text-text-muted">個</span>
                                </div>
                            )}
                        </div>

                        <footer className="p-4 border-t border-border-base bg-bg-base/50 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setIsBatchTagModalOpen(false)
                                    setSelectedTagSlugsForBatch([])
                                }}
                                className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-base transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => batchUpdateTagsMutation.mutate()}
                                disabled={batchUpdateTagsMutation.isPending || selectedTagSlugsForBatch.length === 0}
                                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors inline-flex items-center ${
                                    batchTagMode === 'add'
                                        ? 'bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-emerald-500/50'
                                        : 'bg-amber-500 hover:bg-amber-600 text-white disabled:bg-amber-500/50'
                                }`}
                            >
                                {batchUpdateTagsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {batchTagMode === 'add' ? '確認添加' : '確認移除'}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingQuestion && (
                <EditQuestionModal
                    question={editingQuestion}
                    onClose={() => setEditingQuestion(null)}
                    onSave={(payload) => updateMutation.mutate({ id: editingQuestion.id, payload })}
                    isSaving={updateMutation.isPending}
                    onTagsChange={(add, remove) => updateTagsMutation.mutate({ questionId: editingQuestion.id, add, remove })}
                    isUpdatingTags={updateTagsMutation.isPending}
                />
            )}
        </>
    )
}

function EditQuestionModal({ question, onClose, onSave, isSaving, onTagsChange, isUpdatingTags }: { question: Question, onClose: () => void, onSave: (p: Partial<Question>) => void, isSaving: boolean, onTagsChange: (add: string[], remove: string[]) => void, isUpdatingTags: boolean }) {
    const [stem, setStem] = useState(question.stem)
    const [explanation, setExplanation] = useState(question.explanation || '')
    const [options, setOptions] = useState(question.options as Record<string, string>)
    const [answer, setAnswer] = useState(question.answer)
    const [generatingExplanation, setGeneratingExplanation] = useState(false)
    const [selectedTagSlugs, setSelectedTagSlugs] = useState<string[]>(question.tags.map(t => t.slug))
    const [activeTab, setActiveTab] = useState<'content' | 'tags'>('content')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        onSave({ stem, explanation, options, answer })
    }

    const generateExplanation = async () => {
        setGeneratingExplanation(true)
        try {
            const res = await fetch('/api/llm/generate-explanations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken(),
                },
                credentials: 'include',
                body: JSON.stringify({
                    questions: [{ stem, options, answer }],
                }),
            })
            const data = await res.json()
            if (data.ok && Array.isArray(data.data?.explanations) && data.data.explanations[0]) {
                setExplanation(data.data.explanations[0])
            } else {
                alert(`生成詳解失敗: ${data.message || '未知錯誤'}`)
            }
        } catch {
            alert('生成詳解失敗')
        } finally {
            setGeneratingExplanation(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-bg-surface w-full max-w-3xl h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 border border-border-base">
                <header className="p-4 border-b border-border-base flex justify-between items-center bg-bg-base/50">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-heading font-bold text-text-base flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-primary-base" />
                            編輯題目
                        </h2>
                        <div className="flex bg-bg-base rounded-lg p-1 border border-border-base">
                            <button
                                type="button"
                                onClick={() => setActiveTab('content')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${activeTab === 'content' ? 'bg-primary-base text-white' : 'text-text-muted hover:text-text-base'}`}
                            >
                                內容
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('tags')}
                                className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'tags' ? 'bg-primary-base text-white' : 'text-text-muted hover:text-text-base'}`}
                            >
                                <Tags className="w-3.5 h-3.5" />
                                標籤 ({selectedTagSlugs.length})
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-bg-base rounded-full text-text-muted">
                        <X className="w-5 h-5" />
                    </button>
                </header>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'content' ? (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-base">題幹 (Stem)</label>
                                <textarea
                                    value={stem}
                                    onChange={(e) => setStem(e.target.value)}
                                    rows={4}
                                    className="w-full px-4 py-3 border border-border-base rounded-xl bg-bg-base text-text-base text-sm focus:ring-2 focus:ring-primary-base outline-none transition-all font-mono"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(['A', 'B', 'C', 'D'] as const).map((key) => (
                                    <div key={key} className={`space-y-2 p-3 rounded-xl border transition-colors ${answer === key ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border-base bg-bg-base/30'}`}>
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs font-bold text-text-muted">選項 {key}</label>
                                            <button
                                                type="button"
                                                onClick={() => setAnswer(key)}
                                                className={`text-[10px] px-2 py-0.5 rounded border transition-all ${answer === key ? 'bg-emerald-500 text-white border-emerald-500' : 'text-text-muted border-border-base hover:border-emerald-500/50'}`}
                                            >
                                                設為正確答案
                                            </button>
                                        </div>
                                        <input
                                            value={options[key]}
                                            onChange={(e) => setOptions({ ...options, [key]: e.target.value })}
                                            className="w-full bg-transparent border-b border-border-base py-1 text-sm focus:outline-none focus:border-primary-base text-text-base"
                                        />
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-text-base">詳解 (Explanation)</label>
                                    <button
                                        type="button"
                                        onClick={generateExplanation}
                                        disabled={generatingExplanation}
                                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg text-violet-500 hover:bg-violet-500/10 border border-violet-500/30 transition-colors disabled:opacity-50"
                                    >
                                        {generatingExplanation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        AI 生成詳解
                                    </button>
                                </div>
                                <textarea
                                    value={explanation}
                                    onChange={(e) => setExplanation(e.target.value)}
                                    rows={6}
                                    placeholder="輸入解析內容..."
                                    className="w-full px-4 py-3 border border-border-base rounded-xl bg-bg-base text-text-base text-sm focus:ring-2 focus:ring-primary-base outline-none transition-all"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-medium text-text-base">管理題目標籤</h3>
                                    <p className="text-xs text-text-muted mt-0.5">選擇要添加或移除的標籤，變更將立即保存</p>
                                </div>
                                {isUpdatingTags && <Loader2 className="w-4 h-4 animate-spin text-primary-base" />}
                            </div>
                            <GroupedTagMultiSelect
                                selectedSlugs={selectedTagSlugs}
                                onChange={(newSlugs) => {
                                    const originalSlugs = question.tags.map(t => t.slug)
                                    const add = newSlugs.filter(s => !originalSlugs.includes(s))
                                    const remove = originalSlugs.filter(s => !newSlugs.includes(s))
                                    setSelectedTagSlugs(newSlugs)
                                    if (add.length > 0 || remove.length > 0) {
                                        onTagsChange(add, remove)
                                    }
                                }}
                                className="max-h-[500px]"
                            />
                        </div>
                    )}
                </form>

                <footer className="p-4 border-t border-border-base bg-bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-2 text-sm font-medium text-text-muted hover:text-text-base"
                    >
                        關閉
                    </button>
                    {activeTab === 'content' && (
                        <button
                            onClick={handleSubmit}
                            disabled={isSaving}
                            className="btn-primary !px-8 !py-2.5 text-sm gap-2"
                        >
                            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                            儲存變更
                        </button>
                    )}
                </footer>
            </div>
        </div>
    )
}
