'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { log } from '@/lib/logger'
import { cn } from '@/lib/cn'
import { LatexText } from '@/components/ui/LatexText'
import { fetchApi, ApiClientError } from '@/lib/apiClient'
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
    XCircle,
    CheckSquare,
    Square,
    Sparkles,
} from 'lucide-react'
import { GroupedTagMultiSelect } from '@/components/quiz/GroupedTagMultiSelect'
import { QuestionImageUploader } from './QuestionImageUploader'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExtractedQuestion {
    stem: string
    options: { A: string; B: string; C: string; D: string }
    answer: 'A' | 'B' | 'C' | 'D'
    explanation?: string
    imagePlaceholders?: string[]
    imageUrls?: string[]
    tagSlugs?: string[]
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
    errorLog?: string | null
    geminiMeta: GeminiMeta | null
    createdAt: string
}

type DraftStatus = 'AWAITING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PROCESSING'

const STATUS_TABS: { key: DraftStatus | 'ALL'; label: string; color: string }[] = [
    { key: 'AWAITING_REVIEW', label: '待審核', color: 'text-amber-400' },
    { key: 'APPROVED', label: '已通過', color: 'text-green-400' },
    { key: 'REJECTED', label: '已退回', color: 'text-red-400' },
    { key: 'PROCESSING', label: '解析中', color: 'text-blue-400' },
    { key: 'ALL', label: '全部', color: 'text-text-muted' },
]

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

    // Status filter
    const [statusFilter, setStatusFilter] = useState<DraftStatus | 'ALL'>('AWAITING_REVIEW')

    // Batch selection
    const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set())
    const [batchProcessing, setBatchProcessing] = useState(false)

    // Reject modal
    const [rejectingDraftId, setRejectingDraftId] = useState<string | null>(null)
    const [rejectReason, setRejectReason] = useState('')
    const [rejecting, setRejecting] = useState(false)

    // Import Modal State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)
    const [importYear, setImportYear] = useState<string>('')
    const [importExamType, setImportExamType] = useState<string>('')

    // Explanation generation state
    const [generatingExplanations, setGeneratingExplanations] = useState(false)
    const [generatingExplanationIdx, setGeneratingExplanationIdx] = useState<number | null>(null)
    const [explanationProgress, setExplanationProgress] = useState<{ done: number; total: number; cached?: number; message?: string } | null>(null)
    const [explanationJobId, setExplanationJobId] = useState<string | null>(null)
    const [explanationModel, setExplanationModel] = useState<'fast' | 'precise'>('fast')
    const [explanationPaused, setExplanationPaused] = useState(false)
    const [explanationCancelling, setExplanationCancelling] = useState(false)
    const explanationPollRef = useRef(false) // used to cancel polling on unmount

    // Cleanup polling on unmount
    useEffect(() => {
        return () => { explanationPollRef.current = true }
    }, [])

    const fetchDrafts = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await fetchApi<ParsedDraft[]>(`/api/parser/drafts?limit=50&status=${statusFilter}`)
            setDrafts(data)
            // Auto-select first draft if current selection is gone
            if (data.length > 0) {
                const ids = new Set(data.map((d) => d.id))
                if (!activeDraftId || !ids.has(activeDraftId)) {
                    setActiveDraftId(data[0].id)
                }
            } else {
                setActiveDraftId(null)
            }
        } catch (err) {
            if (err instanceof ApiClientError) {
                setError(err.message)
            } else {
                setError('API 連線失敗')
            }
        } finally {
            setLoading(false)
            setSelectedDraftIds(new Set())
        }
    }, [statusFilter, activeDraftId])

    useEffect(() => {
        fetchDrafts()
    }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

    const activeDraft = drafts.find((d) => d.id === activeDraftId)
    const questions = activeDraft?.draftJson?.questions ?? []
    const metadata = activeDraft?.draftJson?.metadata
    const geminiMeta = activeDraft?.geminiMeta

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
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

    const removeDraftFromView = (draftId: string) => {
        setDrafts(prev => prev.filter(d => d.id !== draftId))
        if (activeDraftId === draftId) {
            const remaining = drafts.filter(d => d.id !== draftId)
            setActiveDraftId(remaining.length > 0 ? remaining[0].id : null)
        }
        setSelectedDraftIds(prev => {
            const next = new Set(prev)
            next.delete(draftId)
            return next
        })
    }

    // ---------------------------------------------------------------------------
    // Explanation Generation (Worker-based with polling)
    // ---------------------------------------------------------------------------
    const generateExplanationsForAll = async () => {
        if (!activeDraft || questions.length === 0) return
        setGeneratingExplanations(true)
        setSaveMsg(null)
        setExplanationProgress({ done: 0, total: questions.length, message: '正在提交任務...' })

        try {
            // 1. Enqueue the job
            const enqueueResult = await fetchApi<{ jobId: string }>('/api/llm/generate-explanations/enqueue', {
                method: 'POST',
                body: JSON.stringify({
                    draftId: activeDraft.id,
                    model: explanationModel,
                    questions: questions.map((q, i) => ({
                        index: i,
                        stem: q.stem,
                        options: q.options,
                        answer: q.answer,
                    })),
                }),
            })

            const jobId = enqueueResult.jobId
            setExplanationJobId(jobId)
            setExplanationProgress({ done: 0, total: questions.length, message: '任務已提交，等待處理...' })

            // 2. Poll for status
            const POLL_INTERVAL = 2000
            const MAX_POLLS = 900 // 30 minutes max
            let pollCount = 0

            const poll = async (): Promise<void> => {
                if (explanationPollRef.current) return // cancelled
                pollCount++
                if (pollCount > MAX_POLLS) {
                    setSaveMsg('解釋生成任務超時，請稍後查看結果')
                    setGeneratingExplanations(false)
                    setExplanationProgress(null)
                    setExplanationJobId(null)
                    return
                }

                try {
                    const status = await fetchApi<{
                        jobId: string
                        state: string
                        progress: { done: number; total: number; cached?: number; partialResults?: Record<string, string>; message?: string } | null
                        result?: { explanations: Record<string, string> }
                        errorReason?: string
                    }>(`/api/llm/generate-explanations/status/${jobId}`)

                    if (status.state === 'completed') {
                        // Apply all results to state
                        const results = status.result?.explanations ?? {}
                        setDrafts(prev => prev.map(d => {
                            if (d.id !== activeDraftId) return d
                            const newQ = d.draftJson.questions.map((q, i) => ({
                                ...q,
                                explanation: results[String(i)] || q.explanation || '',
                            }))
                            return { ...d, draftJson: { ...d.draftJson, questions: newQ } }
                        }))

                        const generatedCount = Object.values(results).filter(e => e).length
                        const cachedCount = status.progress?.cached ?? 0
                        const cacheNote = cachedCount > 0 ? `（快取 ${cachedCount} 題）` : ''
                        setSaveMsg(`已為 ${generatedCount} 題生成詳解${cacheNote}`)
                        setTimeout(() => setSaveMsg(null), 5000)

                        setGeneratingExplanations(false)
                        setExplanationProgress(null)
                        setExplanationJobId(null)
                        setExplanationPaused(false)
                        return
                    }

                    if (status.state === 'failed') {
                        const reason = status.errorReason || '未知錯誤'
                        setSaveMsg(`詳解生成失敗: ${reason.slice(0, 100)}`)
                        setTimeout(() => setSaveMsg(null), 5000)

                        // Still apply any partial results
                        const partialResults = status.progress?.partialResults ?? {}
                        if (Object.keys(partialResults).length > 0) {
                            setDrafts(prev => prev.map(d => {
                                if (d.id !== activeDraftId) return d
                                const newQ = d.draftJson.questions.map((q, i) => ({
                                    ...q,
                                    explanation: partialResults[String(i)] || q.explanation || '',
                                }))
                                return { ...d, draftJson: { ...d.draftJson, questions: newQ } }
                            }))
                        }

                        setGeneratingExplanations(false)
                        setExplanationProgress(null)
                        setExplanationJobId(null)
                        setExplanationPaused(false)
                        return
                    }

                    // Still in progress — update UI
                    if (status.progress && typeof status.progress === 'object' && 'done' in status.progress) {
                        setExplanationProgress({
                            done: status.progress.done,
                            total: status.progress.total,
                            cached: status.progress.cached,
                            message: status.progress.message,
                        })
                    }

                    // Check if job is paused via message
                    if (status.progress?.message?.includes('暫停')) {
                        setExplanationPaused(true)
                    } else if (explanationPaused && !status.progress?.message?.includes('暫停')) {
                        setExplanationPaused(false)
                    }

                    // Continue polling
                    setTimeout(poll, POLL_INTERVAL)
                } catch {
                    // Polling error — retry
                    setTimeout(poll, POLL_INTERVAL * 2)
                }
            }

            // Start polling after a brief delay
            setTimeout(poll, POLL_INTERVAL)
        } catch (err: unknown) {
            const msg = (err as any)?.message || '未知錯誤'
            log.error('audit', 'Failed to enqueue explanation generation', { detail: msg })
            setSaveMsg(`提交詳解生成任務失敗: ${msg}`)
            setTimeout(() => setSaveMsg(null), 5000)
            setGeneratingExplanations(false)
            setExplanationProgress(null)
        }
    }

    // Pause/Resume explanation generation
    const pauseExplanationGeneration = async () => {
        if (!explanationJobId) return
        try {
            await fetchApi(`/api/llm/generate-explanations/pause/${explanationJobId}`, {
                method: 'POST',
            })
            setExplanationPaused(true)
            setSaveMsg('詳解生成已暫停')
            setTimeout(() => setSaveMsg(null), 3000)
        } catch (err: unknown) {
            const msg = err instanceof ApiClientError ? err.message : '暫停失敗'
            setSaveMsg(`暫停失敗: ${msg}`)
            setTimeout(() => setSaveMsg(null), 3000)
        }
    }

    const resumeExplanationGeneration = async () => {
        if (!explanationJobId) return
        try {
            await fetchApi(`/api/llm/generate-explanations/pause/${explanationJobId}`, {
                method: 'DELETE',
            })
            setExplanationPaused(false)
            setSaveMsg('詳解生成已恢復')
            setTimeout(() => setSaveMsg(null), 3000)
        } catch (err: unknown) {
            const msg = err instanceof ApiClientError ? err.message : '恢復失敗'
            setSaveMsg(`恢復失敗: ${msg}`)
            setTimeout(() => setSaveMsg(null), 3000)
        }
    }

    // Cancel explanation generation
    const cancelExplanationGeneration = async () => {
        if (!explanationJobId) return
        if (!confirm('確定要取消詳解生成嗎？已生成的部分結果仍會保留。')) return

        setExplanationCancelling(true)
        try {
            await fetchApi(`/api/llm/generate-explanations/cancel/${explanationJobId}`, {
                method: 'DELETE',
            })
            
            // Stop polling
            explanationPollRef.current = true
            
            setSaveMsg('詳解生成已取消')
            setTimeout(() => setSaveMsg(null), 3000)
            
            setGeneratingExplanations(false)
            setExplanationProgress(null)
            setExplanationJobId(null)
            setExplanationPaused(false)
        } catch (err: unknown) {
            const msg = err instanceof ApiClientError ? err.message : '取消失敗'
            setSaveMsg(`取消失敗: ${msg}`)
            setTimeout(() => setSaveMsg(null), 3000)
        } finally {
            setExplanationCancelling(false)
            // Reset the poll ref after a delay to allow future jobs
            setTimeout(() => { explanationPollRef.current = false }, 1000)
        }
    }

    const generateExplanationForOne = async (index: number) => {
        const q = questions[index]
        if (!q) return
        setGeneratingExplanationIdx(index)
        try {
            const result = await fetchApi<{ explanations: string[] }>('/api/llm/generate-explanations', {
                method: 'POST',
                body: JSON.stringify({
                    questions: [{ stem: q.stem, options: q.options, answer: q.answer }],
                }),
            })
            if (result.explanations[0]) {
                updateQuestion(index, { explanation: result.explanations[0] })
            }
        } catch (err: unknown) {
            const msg = (err as any)?.message || '未知錯誤'
            log.error('audit', 'Single generate explanation failed', { detail: msg })
            setSaveMsg(`生成詳解失敗: ${msg}`)
            setTimeout(() => setSaveMsg(null), 3000)
        } finally {
            setGeneratingExplanationIdx(null)
        }
    }

    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------
    const saveDraft = async () => {
        if (!activeDraft) return
        setSaving(true)
        setSaveMsg(null)
        try {
            await fetchApi('/api/parser/drafts', {
                method: 'PATCH',
                body: JSON.stringify({
                    draftId: activeDraft.id,
                    draftJson: activeDraft.draftJson,
                }),
            })
            setSaveMsg('已儲存')
            setEditingQ(null)
            setTimeout(() => setSaveMsg(null), 3000)
        } catch (err) {
            const msg = err instanceof ApiClientError ? err.message : '儲存失敗'
            log.error('audit', 'Save draft failed', { error: err instanceof Error ? err.message : String(err) })
            setSaveMsg(`儲存失敗: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    const publishDraft = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!activeDraftId || !activeDraft) return

        setPublishing(true)
        setSaveMsg(null)
        try {
            // Step 1: Save latest draft changes before publishing
            setSaveMsg('正在儲存最新修改...')
            await fetchApi('/api/parser/drafts', {
                method: 'PATCH',
                body: JSON.stringify({
                    draftId: activeDraft.id,
                    draftJson: activeDraft.draftJson,
                }),
            })

            // Step 2: Publish with the saved draftJson
            setSaveMsg('正在匯入題庫...')
            await fetchApi(`/api/parser/drafts/${activeDraftId}/publish`, {
                method: 'POST',
                body: JSON.stringify({
                    year: importYear ? parseInt(importYear, 10) : undefined,
                    examType: importExamType || undefined,
                    draftJson: activeDraft.draftJson,
                })
            })

            setSaveMsg('匯入題庫成功')
            setIsImportModalOpen(false)
            removeDraftFromView(activeDraftId)

        } catch (err: unknown) {
            const message = err instanceof ApiClientError ? err.message
                : err instanceof Error ? err.message : '未知錯誤'
            log.error('audit', 'Publish draft failed', { error: err instanceof Error ? err.message : String(err) })
            setSaveMsg(`匯入失敗: ${message}`)
        } finally {
            setPublishing(false)
        }
    }

    const deleteDraft = async () => {
        if (!activeDraftId) return
        if (!confirm('確定要永久刪除這份草稿與上傳的原檔嗎？此動作無法復原。')) return

        setDeleting(true)
        try {
            await fetchApi(`/api/parser/drafts/${activeDraftId}`, {
                method: 'DELETE',
            })
            removeDraftFromView(activeDraftId)
        } catch (err) {
            const msg = err instanceof ApiClientError ? err.message : '刪除草稿失敗'
            alert(msg)
        } finally {
            setDeleting(false)
        }
    }

    const rejectDraft = async () => {
        if (!rejectingDraftId) return
        setRejecting(true)
        try {
            await fetchApi('/api/parser/drafts', {
                method: 'PATCH',
                body: JSON.stringify({
                    draftId: rejectingDraftId,
                    status: 'REJECTED',
                    errorLog: rejectReason || '審核員手動退回',
                }),
            })
            setSaveMsg('已退回草稿')
            setTimeout(() => setSaveMsg(null), 3000)
            setRejectingDraftId(null)
            setRejectReason('')
            // Remove from current view if not viewing ALL or REJECTED
            if (statusFilter !== 'ALL' && statusFilter !== 'REJECTED') {
                removeDraftFromView(rejectingDraftId)
            } else {
                // Update the status in-place
                setDrafts(prev => prev.map(d =>
                    d.id === rejectingDraftId ? { ...d, status: 'REJECTED', errorLog: rejectReason || '審核員手動退回' } : d
                ))
            }
        } catch (err) {
            const msg = err instanceof ApiClientError ? err.message : '退回失敗'
            log.error('audit', 'Reject draft failed', { error: err instanceof Error ? err.message : String(err) })
            setSaveMsg(`退回失敗: ${msg}`)
        } finally {
            setRejecting(false)
        }
    }

    // ---------------------------------------------------------------------------
    // Batch operations
    // ---------------------------------------------------------------------------
    const toggleBatchSelect = (id: string) => {
        setSelectedDraftIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleAllBatch = () => {
        if (selectedDraftIds.size === drafts.length) {
            setSelectedDraftIds(new Set())
        } else {
            setSelectedDraftIds(new Set(drafts.map(d => d.id)))
        }
    }

    const batchPublish = async () => {
        if (selectedDraftIds.size === 0) return
        if (!confirm(`確定要批次匯入 ${selectedDraftIds.size} 份草稿？`)) return

        setBatchProcessing(true)
        setSaveMsg(null)
        let successCount = 0
        let failCount = 0

        for (const draftId of selectedDraftIds) {
            try {
                await fetchApi(`/api/parser/drafts/${draftId}/publish`, {
                    method: 'POST',
                    body: JSON.stringify({})
                })
                successCount++
            } catch {
                failCount++
            }
        }

        setSaveMsg(`批次匯入完成: ${successCount} 成功, ${failCount} 失敗`)
        setTimeout(() => setSaveMsg(null), 5000)
        setBatchProcessing(false)
        fetchDrafts()
    }

    const batchDelete = async () => {
        if (selectedDraftIds.size === 0) return
        if (!confirm(`確定要永久刪除 ${selectedDraftIds.size} 份草稿？此動作無法復原。`)) return

        setBatchProcessing(true)
        setSaveMsg(null)
        let successCount = 0
        let failCount = 0

        for (const draftId of selectedDraftIds) {
            try {
                await fetchApi(`/api/parser/drafts/${draftId}`, {
                    method: 'DELETE',
                })
                successCount++
            } catch {
                failCount++
            }
        }

        setSaveMsg(`批次刪除完成: ${successCount} 成功, ${failCount} 失敗`)
        setTimeout(() => setSaveMsg(null), 5000)
        setBatchProcessing(false)
        fetchDrafts()
    }

    const getDisplayName = (d: ParsedDraft) => d.originalFilename ?? d.originalUrl.split('/').pop() ?? '未知檔案'
    const getDisplayTime = (d: ParsedDraft) =>
        new Date(d.createdAt).toLocaleString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'AWAITING_REVIEW': return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-400">待審核</span>
            case 'APPROVED': return <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/15 text-green-400">已通過</span>
            case 'REJECTED': return <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/15 text-red-400">已退回</span>
            case 'PROCESSING': return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/15 text-blue-400">解析中</span>
            default: return <span className="px-2 py-0.5 text-xs rounded-full bg-primary-base/15 text-text-muted">{status}</span>
        }
    }

    // --- Loading / Error / Empty states ---
    if (loading) {
        return (
            <div className="space-y-4">
                <StatusTabs active={statusFilter} onChange={setStatusFilter} />
                <div className="flex items-center justify-center py-20 text-text-muted">
                    <Loader2 className="size-6 animate-spin mr-3" />
                    正在載入草稿...
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="space-y-4">
                <StatusTabs active={statusFilter} onChange={setStatusFilter} />
                <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl">
                    <AlertCircle className="size-5 shrink-0" />
                    {error}
                </div>
            </div>
        )
    }

    if (drafts.length === 0) {
        return (
            <div className="space-y-4">
                <StatusTabs active={statusFilter} onChange={setStatusFilter} />
                <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
                    <BookOpen className="size-10 opacity-30" />
                    <p className="text-sm">
                        {statusFilter === 'AWAITING_REVIEW'
                            ? '目前沒有待審核的 AI 解析草稿'
                            : `目前沒有「${STATUS_TABS.find(t => t.key === statusFilter)?.label}」狀態的草稿`}
                    </p>
                    <p className="text-xs opacity-60">上傳考卷後，AI 解析的結果會顯示在這裡</p>
                </div>
            </div>
        )
    }

    const isReadOnly = activeDraft?.status === 'APPROVED' || activeDraft?.status === 'REJECTED'

    return (
        <div className="space-y-4">
            {/* ═══════════ Status filter tabs ═══════════ */}
            <StatusTabs active={statusFilter} onChange={setStatusFilter} />

            {/* ═══════════ Batch bar ═══════════ */}
            {drafts.length > 1 && (
                <div className="card p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleAllBatch}
                            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-base transition"
                        >
                            {selectedDraftIds.size === drafts.length
                                ? <CheckSquare className="size-4 text-primary-base" />
                                : <Square className="size-4" />}
                            {selectedDraftIds.size > 0
                                ? `已選 ${selectedDraftIds.size} / ${drafts.length}`
                                : `全選 (${drafts.length})`}
                        </button>
                    </div>
                    {selectedDraftIds.size > 0 && (
                        <div className="flex items-center gap-2">
                            {statusFilter === 'AWAITING_REVIEW' && (
                                <button
                                    onClick={batchPublish}
                                    disabled={batchProcessing}
                                    className="btn-primary !py-1.5 !px-3 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500"
                                >
                                    {batchProcessing ? <Loader2 className="size-3 animate-spin" /> : <UploadCloud className="size-3" />}
                                    批次匯入
                                </button>
                            )}
                            <button
                                onClick={batchDelete}
                                disabled={batchProcessing}
                                className="btn-secondary !py-1.5 !px-3 text-xs gap-1.5 !bg-red-500/10 !text-red-500 hover:!bg-red-500/20 border-red-500/20"
                            >
                                {batchProcessing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                批次刪除
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ File info bar ═══════════ */}
            <div className="card p-4">
                <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
                    {/* Left: file selector + metadata chips */}
                    <div className="space-y-3">
                        {/* File selector row */}
                        <div className="flex items-center gap-3 flex-wrap">
                            {drafts.length > 1 && (
                                <button
                                    onClick={() => toggleBatchSelect(activeDraftId!)}
                                    className="shrink-0"
                                >
                                    {selectedDraftIds.has(activeDraftId!)
                                        ? <CheckSquare className="size-4 text-primary-base" />
                                        : <Square className="size-4 text-text-muted" />}
                                </button>
                            )}
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
                            {activeDraft && getStatusBadge(activeDraft.status)}
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

                        {/* Error log for rejected/failed drafts */}
                        {activeDraft?.errorLog && (
                            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/15 rounded-lg p-3">
                                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                                <span className="whitespace-pre-wrap">{activeDraft.errorLog}</span>
                            </div>
                        )}
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={fetchDrafts}
                            className="btn-secondary !px-5 !py-2.5 text-sm gap-2"
                        >
                            <RefreshCw className="size-4" />
                            重新載入
                        </button>
                        {!isReadOnly && (
                            <button
                                onClick={saveDraft}
                                disabled={saving}
                                className="btn-primary !px-5 !py-2.5 text-sm gap-2"
                            >
                                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                                儲存修改
                            </button>
                        )}
                        {!isReadOnly && questions.length > 0 && (
                            <>
                                <select
                                    value={explanationModel}
                                    onChange={(e) => setExplanationModel(e.target.value as 'fast' | 'precise')}
                                    disabled={generatingExplanations}
                                    className="px-2 py-1.5 text-xs rounded-md border border-border-base bg-bg-base text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                                    title="選擇 AI 模型"
                                >
                                    <option value="fast">快速模式</option>
                                    <option value="precise">精準模式</option>
                                </select>
                                <button
                                    onClick={generateExplanationsForAll}
                                    disabled={generatingExplanations || saving}
                                    className="btn-secondary !px-5 !py-2.5 text-sm gap-2 !text-violet-500 !border-violet-500/30 hover:!bg-violet-500/10"
                                >
                                    {generatingExplanations ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                    AI 批次生成詳解
                                </button>
                            </>
                        )}
                        {explanationProgress && (
                            <div className="w-full max-w-[240px] space-y-2">
                                <div className="h-2 rounded-full bg-violet-500/15 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-violet-500 transition-all duration-300 ease-out"
                                        style={{ width: `${Math.round((explanationProgress.done / explanationProgress.total) * 100)}%` }}
                                    />
                                </div>
                                <p className="text-[11px] text-violet-400 text-center tabular-nums">
                                    {explanationProgress.done}/{explanationProgress.total} 題
                                    {explanationProgress.cached ? ` (快取 ${explanationProgress.cached})` : ''}
                                </p>
                                {explanationProgress.message && (
                                    <p className="text-[10px] text-text-muted text-center truncate" title={explanationProgress.message}>
                                        {explanationProgress.message}
                                    </p>
                                )}
                                {/* Control buttons */}
                                <div className="flex justify-center gap-2 pt-1">
                                    {explanationPaused ? (
                                        <button
                                            onClick={resumeExplanationGeneration}
                                            disabled={explanationCancelling}
                                            className="btn-primary !px-3 !py-1 text-xs bg-emerald-600 hover:bg-emerald-500"
                                        >
                                            繼續
                                        </button>
                                    ) : (
                                        <button
                                            onClick={pauseExplanationGeneration}
                                            disabled={explanationCancelling}
                                            className="btn-secondary !px-3 !py-1 text-xs"
                                        >
                                            暫停
                                        </button>
                                    )}
                                    <button
                                        onClick={cancelExplanationGeneration}
                                        disabled={explanationCancelling}
                                        className="btn-secondary !px-3 !py-1 text-xs !bg-red-500/10 !text-red-500 hover:!bg-red-500/20 border-red-500/20"
                                    >
                                        {explanationCancelling ? <Loader2 className="size-3 animate-spin" /> : '取消'}
                                    </button>
                                </div>
                            </div>
                        )}
                        {saveMsg && (
                            <span className="text-xs text-text-muted text-center max-w-[120px] truncate">{saveMsg}</span>
                        )}
                    </div>
                </div>

                {/* Submit Row */}
                <div className="mt-4 pt-4 border-t border-border-base flex justify-end gap-3">
                    <button
                        onClick={deleteDraft}
                        disabled={deleting || publishing || saving || activeDraft?.status === 'APPROVED'}
                        className="btn-secondary !bg-red-500/10 !text-red-500 hover:!bg-red-500/20 border-red-500/20 !px-4 !py-2.5 text-sm gap-2"
                        title="刪除此份草稿"
                    >
                        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 stroke="currentColor" className="size-4" />}
                        刪除廢棄
                    </button>

                    {/* Reject button — only for AWAITING_REVIEW */}
                    {activeDraft?.status === 'AWAITING_REVIEW' && (
                        <button
                            onClick={() => {
                                setRejectingDraftId(activeDraftId)
                                setRejectReason('')
                            }}
                            disabled={saving || publishing || deleting}
                            className="btn-secondary !bg-orange-500/10 !text-orange-500 hover:!bg-orange-500/20 border-orange-500/20 !px-4 !py-2.5 text-sm gap-2"
                        >
                            <XCircle className="size-4" />
                            退回
                        </button>
                    )}

                    {/* Publish button — only for AWAITING_REVIEW */}
                    {activeDraft?.status === 'AWAITING_REVIEW' && (
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
                    )}
                </div>
            </div>

            {/* ═══════════ Reject Modal ═══════════ */}
            {rejectingDraftId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-bg-surface w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 p-6 space-y-4 border border-border-base">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-full bg-orange-500/10">
                                <XCircle className="size-5 text-orange-500" />
                            </div>
                            <h2 className="text-lg font-heading font-bold text-text-base">退回草稿</h2>
                        </div>
                        <p className="text-sm text-text-muted">
                            退回後草稿將標記為「已退回」狀態。您可以附帶退回原因供後續追蹤。
                        </p>
                        <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="退回原因 (選填)..."
                            rows={3}
                            className="w-full px-4 py-2 border border-border-base rounded-lg bg-bg-base text-text-base text-sm focus:ring-2 focus:ring-orange-500/50 outline-none transition-all resize-y"
                        />
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setRejectingDraftId(null)}
                                disabled={rejecting}
                                className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-base transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={rejectDraft}
                                disabled={rejecting}
                                className="flex items-center gap-2 px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                {rejecting ? <Loader2 className="size-4 animate-spin" /> : null}
                                確認退回
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════ Import Confirmation Modal ═══════════ */}
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
                    const isEditing = editingQ === i && !isReadOnly

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
                                    {q.imagePlaceholders && q.imagePlaceholders.length > (q.imageUrls?.length || 0) && (
                                        <span className="inline-block mt-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">
                                            含 {q.imagePlaceholders.length - (q.imageUrls?.length || 0)} 張圖片待截取
                                        </span>
                                    )}
                                </button>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {!isReadOnly && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (editingQ === i) { setEditingQ(null) } else { startEdit(i) }
                                            }}
                                            className={cn(
                                                "p-1.5 rounded-lg transition-colors",
                                                editingQ === i
                                                    ? "bg-primary-base/20 text-primary-base"
                                                    : "text-text-muted hover:text-text-base hover:bg-bg-base"
                                            )}
                                            title={editingQ === i ? "結束編輯" : "編輯此題"}
                                        >
                                            {editingQ === i ? <Check className="size-4" /> : <Pencil className="size-4" />}
                                        </button>
                                    )}
                                    {isEditing ? (
                                        <select
                                            value={q.answer}
                                            onChange={(e) => updateQuestion(i, { answer: e.target.value as 'A' | 'B' | 'C' | 'D' })}
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

                                    {/* 圖片區域 (上傳與預覽) */}
                                    {(q.imagePlaceholders?.length || q.imageUrls?.length || isEditing) ? (
                                        <div className="space-y-3 p-3 bg-bg-surface/50 rounded-xl border border-border-base">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold text-text-muted">圖片附件</p>
                                                {isEditing && (
                                                    <QuestionImageUploader
                                                        onUploadComplete={(url) => {
                                                            const newUrls = [...(q.imageUrls || []), url]
                                                            updateQuestion(i, { imageUrls: newUrls })
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            {q.imageUrls && q.imageUrls.length > 0 && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                    {q.imageUrls.map((url, imgIdx) => (
                                                        <div key={imgIdx} className="relative group rounded-lg overflow-hidden border border-border-base aspect-video bg-black/50">
                                                                <img
                                                                    src={url}
                                                                    alt={`附件 ${imgIdx + 1}`}
                                                                    className="w-full h-full object-contain"
                                                                    onError={(e) => {
                                                                        // Fallback if url is already a full URL or needs our specific CDN path
                                                                        if (!url.startsWith('http') && !url.startsWith('/')) {
                                                                            e.currentTarget.src = `/${url}`
                                                                        }
                                                                    }}
                                                                />
                                                            {isEditing && (
                                                                <button
                                                                    onClick={() => {
                                                                        const newUrls = q.imageUrls!.filter((_, idx) => idx !== imgIdx)
                                                                        updateQuestion(i, { imageUrls: newUrls })
                                                                    }}
                                                                    className="absolute top-1 right-1 p-1 bg-red-500/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                                >
                                                                    <Trash2 className="size-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : null}

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
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className="text-xs text-text-muted">詳解</label>
                                                    <button
                                                        onClick={() => generateExplanationForOne(i)}
                                                        disabled={generatingExplanationIdx === i || generatingExplanations}
                                                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md text-violet-500 hover:bg-violet-500/10 border border-violet-500/30 transition-colors disabled:opacity-50"
                                                    >
                                                        {generatingExplanationIdx === i ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                                        AI 生成
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={q.explanation ?? ''}
                                                    onChange={(e) => updateQuestion(i, { explanation: e.target.value })}
                                                    rows={3}
                                                    className="input !py-2 text-sm font-mono resize-y"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-text-muted mb-1 block">標籤設定</label>
                                                <GroupedTagMultiSelect
                                                    selectedSlugs={q.tagSlugs ?? []}
                                                    onChange={(slugs) => updateQuestion(i, { tagSlugs: slugs })}
                                                    className="w-full bg-bg-base/40"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {q.explanation && (
                                                <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3">
                                                    <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">詳解</p>
                                                    <p className="text-sm text-text-base leading-relaxed whitespace-pre-wrap">
                                                        <LatexText>{q.explanation}</LatexText>
                                                    </p>
                                                </div>
                                            )}
                                            {q.tagSlugs && q.tagSlugs.length > 0 && (
                                                <div className="flex items-center gap-2 bg-bg-surface/40 p-2.5 rounded-xl border border-border-base">
                                                    <p className="text-xs font-semibold text-text-muted shrink-0">標籤</p>
                                                    <p className="text-xs text-text-muted">
                                                        已選 {q.tagSlugs.length} 個標籤 (進入編輯模式查看詳情)
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

// ---------------------------------------------------------------------------
// Status Tabs sub-component
// ---------------------------------------------------------------------------
function StatusTabs({ active, onChange }: { active: string; onChange: (s: DraftStatus | 'ALL') => void }) {
    return (
        <div className="flex items-center gap-1 bg-bg-base rounded-xl p-1 border border-border-base overflow-x-auto">
            {STATUS_TABS.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => onChange(tab.key)}
                    className={cn(
                        "px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap",
                        active === tab.key
                            ? `bg-surface-base shadow-sm ${tab.color} border border-border-base`
                            : "text-text-muted hover:text-text-base hover:bg-bg-muted"
                    )}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    )
}
