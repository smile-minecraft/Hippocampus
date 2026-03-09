'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/cn'
import { LatexText } from '@/components/ui/LatexText'
import {
    AlertCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    BookOpen,
    Clock,
    Zap,
    RefreshCw,
    Save,
    Pencil,
    Check,
    FileText,
    Hash,
    Calendar,
    Layers,
    UploadCloud,
    Trash2,
} from 'lucide-react'
import { GroupedTagMultiSelect } from '@/components/quiz/GroupedTagMultiSelect'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExtractedQuestion {
    stem: string
    options: { A: string; B: string; C: string; D: string }
    answer: 'A' | 'B' | 'C' | 'D'
    explanation?: string
    imagePlaceholders?: string[]
    tagIds?: string[]
}

interface ExtractionMetadata {
    year?: number
    examType?: string
    pageCount: number
}

interface GeminiMeta {
    model: string
    imageCount: number
    totalPayloadMB: string
    totalAttempts: number
    elapsedMs: number
    responseLength: number
    finishReason: string
    promptTokenCount: number
    candidatesTokenCount: number
    questionCount: number
    timestamp: string
}

interface ParsedDraft {
    id: string
    jobId: string
    originalUrl: string
    originalFilename: string | null
    draftJson: {
        questions: ExtractedQuestion[]
        metadata: ExtractionMetadata
    }
    status: string
    geminiMeta: GeminiMeta | null
    createdAt: string
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AuditWorkstation() {
    const [drafts, setDrafts] = useState<ParsedDraft[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
    const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set())
    const [editingQ, setEditingQ] = useState<number | null>(null)
    const [saving, setSaving] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    // Import Modal State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)
    const [importYear, setImportYear] = useState<string>('')
    const [importExamType, setImportExamType] = useState<string>('')

    const fetchDrafts = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/parser/drafts?limit=20')
            const data = await res.json()
            if (data.ok && Array.isArray(data.data)) {
                setDrafts(data.data)
                if (data.data.length > 0 && !activeDraftId) {
                    setActiveDraftId(data.data[0].id)
                }
            } else {
                setError('無法載入草稿資料')
            }
        } catch {
            setError('API 連線失敗')
        } finally {
            setLoading(false)
        }
    }, [activeDraftId])

    useEffect(() => {
        fetchDrafts()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const activeDraft = drafts.find((d) => d.id === activeDraftId)
    const questions = activeDraft?.draftJson?.questions ?? []
    const metadata = activeDraft?.draftJson?.metadata
    const geminiMeta = activeDraft?.geminiMeta

    const toggleQuestion = (index: number) => {
        setExpandedQ((prev) => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const startEdit = (index: number) => {
        setEditingQ(index)
        setExpandedQ((prev) => new Set(prev).add(index))
    }

    const updateQuestion = (index: number, partial: Partial<ExtractedQuestion>) => {
        setDrafts((prev) =>
            prev.map((d) => {
                if (d.id !== activeDraftId) return d
                const newQuestions = [...d.draftJson.questions]
                newQuestions[index] = { ...newQuestions[index], ...partial }
                return { ...d, draftJson: { ...d.draftJson, questions: newQuestions } }
            })
        )
    }

    const updateOption = (qIndex: number, key: 'A' | 'B' | 'C' | 'D', value: string) => {
        setDrafts((prev) =>
            prev.map((d) => {
                if (d.id !== activeDraftId) return d
                const newQuestions = [...d.draftJson.questions]
                newQuestions[qIndex] = {
                    ...newQuestions[qIndex],
                    options: { ...newQuestions[qIndex].options, [key]: value },
                }
                return { ...d, draftJson: { ...d.draftJson, questions: newQuestions } }
            })
        )
    }

    const saveDraft = async () => {
        if (!activeDraft) return
        setSaving(true)
        setSaveMsg(null)
        try {
            const res = await fetch('/api/parser/drafts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draftId: activeDraft.id,
                    draftJson: activeDraft.draftJson,
                }),
            })
            const data = await res.json()
            if (data.ok) {
                setSaveMsg('✅ 已儲存')
                setEditingQ(null)
                setTimeout(() => setSaveMsg(null), 3000)
            } else {
                setSaveMsg(`❌ 儲存失敗: ${data.error}`)
            }
        } catch (err) {
            console.error('Save error:', err)
            setSaveMsg('儲存失敗 ❌')
        } finally {
            setSaving(false)
        }
    }

    const publishDraft = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!activeDraftId) return

        setPublishing(true)
        setSaveMsg(null)
        try {
            const res = await fetch(`/api/parser/drafts/${activeDraftId}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: importYear ? parseInt(importYear, 10) : undefined,
                    examType: importExamType || undefined
                })
            })

            const text = await res.text()
            let data: any
            try { data = JSON.parse(text) } catch { /* ignore */ }

            if (!res.ok || (data && !data.ok)) {
                throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`)
            }

            setSaveMsg('匯入題庫成功 🎉')
            setIsImportModalOpen(false)

            // Optimistic UX strategy: directly remove it to jump to next
            setDrafts(prev => prev.filter(d => d.id !== activeDraftId))
            const remaining = drafts.filter(d => d.id !== activeDraftId)
            if (remaining.length > 0) setActiveDraftId(remaining[0].id)
            else setActiveDraftId(null)

        } catch (err: any) {
            console.error('Publish error:', err)
            setSaveMsg(`匯入失敗 ❌: ${err.message || '未知錯誤'}`)
        } finally {
            setPublishing(false)
        }
    }

    const deleteDraft = async () => {
        if (!activeDraftId) return
        if (!confirm('確定要永久刪除這份草稿與上傳的原檔嗎？此動作無法復原。')) return

        setDeleting(true)
        try {
            const res = await fetch(`/api/parser/drafts/${activeDraftId}`, {
                method: 'DELETE'
            })
            if (!res.ok) throw new Error('刪除失敗')

            // Optimistic UX
            setDrafts(prev => prev.filter(d => d.id !== activeDraftId))
            const remaining = drafts.filter(d => d.id !== activeDraftId)
            if (remaining.length > 0) setActiveDraftId(remaining[0].id)
            else setActiveDraftId(null)

        } catch (err) {
            alert('刪除草稿失敗')
        } finally {
            setDeleting(false)
        }
    }

    const getDisplayName = (d: ParsedDraft) => d.originalFilename ?? d.originalUrl.split('/').pop() ?? '未知檔案'
    const getDisplayTime = (d: ParsedDraft) =>
        new Date(d.createdAt).toLocaleString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })

    // --- Loading / Error / Empty states ---
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-text-muted">
                <Loader2 className="size-6 animate-spin mr-3" />
                正在載入 AI 解析草稿...
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl">
                <AlertCircle className="size-5 shrink-0" />
                {error}
            </div>
        )
    }

    if (drafts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
                <BookOpen className="size-10 opacity-30" />
                <p className="text-sm">目前沒有待審核的 AI 解析草稿</p>
                <p className="text-xs opacity-60">上傳考卷後，AI 解析的結果會顯示在這裡</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* ═══════════ File info bar (full-width grid) ═══════════ */}
            <div className="card p-4">
                <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
                    {/* Left: file selector + metadata chips */}
                    <div className="space-y-3">
                        {/* File selector row */}
                        <div className="flex items-center gap-3 flex-wrap">
                            <FileText className="size-4 text-primary-base shrink-0" />
                            <select
                                value={activeDraftId ?? ''}
                                onChange={(e) => {
                                    setActiveDraftId(e.target.value)
                                    setExpandedQ(new Set())
                                    setEditingQ(null)
                                }}
                                className="input max-w-xl text-sm py-2"
                            >
                                {drafts.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {getDisplayName(d)} — {d.draftJson?.questions?.length ?? 0} 題 ({getDisplayTime(d)})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Metadata chips */}
                        {metadata && (
                            <div className="flex items-center gap-3 flex-wrap">
                                {metadata.year && (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                        <Calendar className="size-3" /> 年份：{metadata.year}
                                    </span>
                                )}
                                {metadata.examType && (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                        <Layers className="size-3" /> 類型：{metadata.examType}
                                    </span>
                                )}
                                <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                    頁數：{metadata.pageCount}
                                </span>
                                <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                    <Hash className="size-3" /> 題數：{questions.length}
                                </span>
                                {geminiMeta && (
                                    <>
                                        <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                            <Zap className="size-3" /> {geminiMeta.model}
                                        </span>
                                        <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                            <Clock className="size-3" /> {(geminiMeta.elapsedMs / 1000).toFixed(1)}s
                                        </span>
                                        <span className="inline-flex items-center gap-1.5 text-xs text-text-muted bg-bg-base px-3 py-1.5 rounded-lg border border-border-base">
                                            {geminiMeta.promptTokenCount + geminiMeta.candidatesTokenCount} tokens
                                        </span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Right: action buttons (large) */}
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={fetchDrafts}
                            className="btn-secondary !px-5 !py-2.5 text-sm gap-2"
                        >
                            <RefreshCw className="size-4" />
                            重新載入
                        </button>
                        <button
                            onClick={saveDraft}
                            disabled={saving}
                            className="btn-primary !px-5 !py-2.5 text-sm gap-2"
                        >
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            儲存修改
                        </button>
                        {saveMsg && (
                            <span className="text-xs text-text-muted text-center max-w-[120px] truncate">{saveMsg}</span>
                        )}
                    </div>
                </div>

                {/* Submit Row */}
                <div className="mt-4 pt-4 border-t border-border-base flex justify-end gap-3">
                    <button
                        onClick={deleteDraft}
                        disabled={deleting || publishing || saving}
                        className="btn-secondary !bg-red-500/10 !text-red-500 hover:!bg-red-500/20 border-red-500/20 !px-4 !py-2.5 text-sm gap-2"
                        title="刪除此份草稿"
                    >
                        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 stroke="currentColor" className="size-4" />}
                        刪除廢棄
                    </button>
                    <button
                        onClick={() => {
                            setImportYear(metadata?.year?.toString() || '')
                            setImportExamType(metadata?.examType || '')
                            setIsImportModalOpen(true)
                        }}
                        disabled={saving || publishing || deleting}
                        className="btn-primary bg-emerald-600 hover:bg-emerald-500 text-white !px-6 !py-2.5 text-sm gap-2"
                    >
                        {publishing ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                        匯入題庫
                    </button>
                </div>
            </div>

            {/* Import Confirmation Modal */}
            {isImportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-bg-surface w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 p-6 space-y-6 border border-border-base">
                        <header>
                            <h2 className="text-xl font-heading font-bold text-text-base">確認匯入資訊</h2>
                            <p className="text-sm text-text-muted mt-2 leading-relaxed">
                                AI 從文檔中提取出以下考卷分類屬性。您可以在此手動修正錯誤，確認無誤後將正式寫入題庫。
                            </p>
                        </header>

                        <form onSubmit={publishDraft} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-base">年份 (Year)</label>
                                <input
                                    type="number"
                                    placeholder="例如: 2024"
                                    value={importYear}
                                    onChange={e => setImportYear(e.target.value)}
                                    className="w-full px-4 py-2 border border-border-base rounded-lg bg-bg-base text-text-base focus:ring-2 focus:ring-primary-base outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-base">考卷類別 / 名稱 (Exam Type)</label>
                                <input
                                    type="text"
                                    placeholder="例如: 專門職業及技術人員醫師高考"
                                    value={importExamType}
                                    onChange={e => setImportExamType(e.target.value)}
                                    className="w-full px-4 py-2 border border-border-base rounded-lg bg-bg-base text-text-base focus:ring-2 focus:ring-primary-base outline-none transition-all"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-border-base">
                                <button
                                    type="button"
                                    onClick={() => setIsImportModalOpen(false)}
                                    disabled={publishing}
                                    className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-base transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={publishing}
                                    className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    {publishing ? <Loader2 className="size-4 animate-spin" /> : null}
                                    確認並匯入
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ═══════════ Question list ═══════════ */}
            <div className="space-y-3">
                {questions.map((q, i) => {
                    const isExpanded = expandedQ.has(i)
                    const isEditing = editingQ === i

                    return (
                        <div
                            key={i}
                            className={cn(
                                "card overflow-hidden transition-colors",
                                isEditing && "!border-primary-base/40 !bg-primary-base/5"
                            )}
                        >
                            {/* Header */}
                            <div className="flex items-start gap-3 p-4">
                                <span className="shrink-0 w-9 h-9 rounded-xl bg-primary-base/15 text-primary-base flex items-center justify-center text-sm font-bold font-heading">
                                    {i + 1}
                                </span>
                                <button
                                    onClick={() => toggleQuestion(i)}
                                    className="flex-1 min-w-0 text-left"
                                >
                                    <p className="text-sm text-text-base leading-relaxed">
                                        <LatexText>{q.stem}</LatexText>
                                    </p>
                                    {q.imagePlaceholders && q.imagePlaceholders.length > 0 && (
                                        <span className="inline-block mt-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">
                                            📷 含 {q.imagePlaceholders.length} 張圖片待截取
                                        </span>
                                    )}
                                </button>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            isEditing ? setEditingQ(null) : startEdit(i)
                                        }}
                                        className={cn(
                                            "p-1.5 rounded-lg transition-colors",
                                            isEditing
                                                ? "bg-primary-base/20 text-primary-base"
                                                : "text-text-muted hover:text-text-base hover:bg-bg-base"
                                        )}
                                        title={isEditing ? "結束編輯" : "編輯此題"}
                                    >
                                        {isEditing ? <Check className="size-4" /> : <Pencil className="size-4" />}
                                    </button>
                                    {isEditing ? (
                                        <select
                                            value={q.answer}
                                            onChange={(e) => updateQuestion(i, { answer: e.target.value as any })}
                                            className="w-11 h-8 text-xs font-bold text-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 focus:outline-none"
                                        >
                                            {(['A', 'B', 'C', 'D'] as const).map((k) => (
                                                <option key={k} value={k}>{k}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                            {q.answer}
                                        </span>
                                    )}
                                    <button onClick={() => toggleQuestion(i)} className="p-1.5 rounded-lg text-text-muted hover:bg-bg-base transition-colors">
                                        {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Expanded */}
                            {isExpanded && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border-base pt-3">
                                    {isEditing && (
                                        <div>
                                            <label className="text-xs text-text-muted mb-1 block">題幹</label>
                                            <textarea
                                                value={q.stem}
                                                onChange={(e) => updateQuestion(i, { stem: e.target.value })}
                                                rows={3}
                                                className="input !py-2 text-sm font-mono resize-y"
                                            />
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {(['A', 'B', 'C', 'D'] as const).map((key) => (
                                            <div
                                                key={key}
                                                className={cn(
                                                    "rounded-xl px-3 py-2.5 text-sm border",
                                                    q.answer === key
                                                        ? "bg-emerald-500/10 border-emerald-500/30"
                                                        : "bg-bg-base border-border-base"
                                                )}
                                            >
                                                {isEditing ? (
                                                    <div className="flex gap-2 items-start">
                                                        <span className="font-bold shrink-0 text-text-muted">{key}.</span>
                                                        <input
                                                            value={q.options[key]}
                                                            onChange={(e) => updateOption(i, key, e.target.value)}
                                                            className="flex-1 bg-transparent border-b border-border-base text-text-base text-sm focus:outline-none focus:border-primary-base font-mono"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className={cn(
                                                        "flex gap-2",
                                                        q.answer === key ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"
                                                    )}>
                                                        <span className="font-bold shrink-0">{key}.</span>
                                                        <span><LatexText>{q.options[key]}</LatexText></span>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {isEditing ? (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-xs text-text-muted mb-1 block">📖 詳解</label>
                                                <textarea
                                                    value={q.explanation ?? ''}
                                                    onChange={(e) => updateQuestion(i, { explanation: e.target.value })}
                                                    rows={3}
                                                    className="input !py-2 text-sm font-mono resize-y"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-text-muted mb-1 block">🏷️ 標籤設定</label>
                                                <GroupedTagMultiSelect
                                                    selectedIds={q.tagIds ?? []}
                                                    onChange={(ids) => updateQuestion(i, { tagIds: ids })}
                                                    className="w-full bg-slate-900/40"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {q.explanation && (
                                                <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3">
                                                    <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">📖 詳解</p>
                                                    <p className="text-sm text-text-base leading-relaxed whitespace-pre-wrap">
                                                        <LatexText>{q.explanation}</LatexText>
                                                    </p>
                                                </div>
                                            )}
                                            {q.tagIds && q.tagIds.length > 0 && (
                                                <div className="flex items-center gap-2 bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/50">
                                                    <p className="text-xs font-semibold text-text-muted shrink-0">🏷️ 標籤</p>
                                                    <p className="text-xs text-slate-400">
                                                        已選 {q.tagIds.length} 個標籤 (進入編輯模式查看詳情)
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
