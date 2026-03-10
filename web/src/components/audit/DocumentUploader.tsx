'use client'

import { useCallback, useEffect, useRef } from 'react'
import { UploadCloud, FileText, X } from 'lucide-react'
import { uploadParserDocument, fetchParserJobStatus, cancelParserJob } from '@/lib/apiClient'
import { log } from '@/lib/logger'
import { useUploadStore } from '@/store'
import type { JobState } from '@/store/uploadSlice'

// ---------------------------------------------------------------------------
// Single job progress row
// ---------------------------------------------------------------------------
function JobProgressRow({ job, onCancel }: { job: JobState; onCancel: (id: string, jobId: string | null) => void }) {
    const progress = (() => {
        if (job.uploading) return { percent: 0, text: '正在上傳至伺服器...' }
        if (job.error) return { percent: 0, text: `❌ ${job.error}` }
        if (!job.status) return { percent: 5, text: '等待佇列...' }

        const s = job.status
        if (s.state === 'completed') return { percent: 100, text: '✅ 解析完成' }
        if (s.state === 'failed') return { percent: 0, text: `❌ ${s.errorReason || '失敗'}` }

        if (typeof s.progress === 'object' && s.progress !== null) {
            const p = s.progress as { percent?: number; message?: string }
            return { percent: p.percent ?? 10, text: p.message ?? '處理中...' }
        }
        if (typeof s.progress === 'number') {
            return { percent: s.progress, text: `處理中 (${s.progress}%)` }
        }
        return { percent: 10, text: '排隊中...' }
    })()

    const isFailed = !!job.error || job.status?.state === 'failed'
    const isDone = job.status?.state === 'completed'
    const isTerminal = isFailed || isDone

    return (
        <div className="rounded-xl border border-border-base bg-bg-surface p-3 space-y-2 group relative">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-base truncate max-w-[200px]" title={job.fileName}>
                    {job.fileName}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted shrink-0">{job.fileSizeMB} MB</span>
                    {!isTerminal && (
                        <button
                            onClick={() => onCancel(job.id, job.jobId)}
                            className="text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="取消任務"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-3">
                <div className="h-2 flex-1 bg-border-base rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 rounded-full ${isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-primary-base'
                            }`}
                        style={{ width: `${progress.percent}%` }}
                    />
                </div>
                <span className="text-xs font-mono text-text-muted shrink-0 w-10 text-right">
                    {isFailed ? '⚠' : `${progress.percent}%`}
                </span>
            </div>
            <p className="text-[11px] text-text-muted leading-snug truncate" title={progress.text}>
                {progress.text}
            </p>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Main uploader component
// ---------------------------------------------------------------------------
export function DocumentUploader() {
    const { jobs, addJob, updateJob, removeJob, clearCompletedJobs } = useUploadStore()
    const pollRefs = useRef<Map<string, NodeJS.Timeout>>(new Map())

    // Start polling for a specific job
    const startPolling = useCallback((localId: string, jobId: string) => {
        if (pollRefs.current.has(localId)) return // Already polling

        const poll = async () => {
            try {
                const res = await fetchParserJobStatus(jobId)
                updateJob(localId, { status: res })

                if (res.state !== 'completed' && res.state !== 'failed') {
                    const t = setTimeout(poll, 2000)
                    pollRefs.current.set(localId, t)
                } else {
                    pollRefs.current.delete(localId)
                }
            } catch (err: unknown) {
                // If the job is literally not found (e.g. after DB reset), stop polling
                if (err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
                    updateJob(localId, { error: '任務已失效 (404)' })
                    pollRefs.current.delete(localId)
                    return
                }
                // generic backoff on other errors (network, 500 etc)
                const t = setTimeout(poll, 4000)
                pollRefs.current.set(localId, t)
            }
        }
        poll()
    }, [updateJob])

    // Cleanup all polls on unmount
    useEffect(() => {
        const polls = pollRefs.current
        return () => {
            polls.forEach((t) => clearTimeout(t))
        }
    }, [])

    // Resume polling on mount for any jobs that are still active
    useEffect(() => {
        jobs.forEach((job) => {
            if (job.jobId && !job.error && job.status?.state !== 'completed' && job.status?.state !== 'failed') {
                startPolling(job.id, job.jobId)
            }
        })
    }, [jobs, startPolling])

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        // Process each file independently (concurrent)
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const localId = `${Date.now()}-${i}`
            const docType = file.name.endsWith('.docx') ? 'word' as const : 'pdf' as const

            const newJob: JobState = {
                id: localId,
                fileName: file.name,
                fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
                jobId: null,
                status: null,
                error: null,
                uploading: true,
            }
            addJob(newJob)

            // Fire upload (non-blocking — each file is independent)
            uploadParserDocument(file, docType)
                .then((res) => {
                    updateJob(localId, { uploading: false, jobId: res.jobId })
                    startPolling(localId, res.jobId)
                })
                .catch((err: unknown) => {
                    updateJob(localId, { uploading: false, error: err instanceof Error ? err.message : '上傳失敗' })
                })
        }

        // Reset the input so the same file can be re-selected
        e.target.value = ''
    }

    const handleCancelJob = async (id: string, jobId: string | null) => {
        // Clear local polling
        if (pollRefs.current.has(id)) {
            clearTimeout(pollRefs.current.get(id))
            pollRefs.current.delete(id)
        }

        // Optimistically remove from UI
        removeJob(id)

        // Cancel on backend if it already has a BullMQ jobId
        if (jobId) {
            try {
                await cancelParserJob(jobId)
            } catch (error) {
                log.error('uploader', 'Failed to cancel job on server', { error: error instanceof Error ? error.message : String(error) })
            }
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            {/* LEFT: Upload zone */}
            <div className="card p-6">
                <div className="flex items-center gap-2 mb-4">
                    <FileText className="size-5 text-primary-base" />
                    <h2 className="text-lg font-heading font-semibold text-text-base">
                        匯入文檔解析
                    </h2>
                </div>

                <label
                    htmlFor="doc-upload-multi"
                    className="cursor-pointer flex flex-col items-center justify-center p-10 border-2 border-dashed border-border-base rounded-xl bg-bg-base hover:border-primary-base/50 hover:bg-primary-base/5 transition-all duration-200 group"
                >
                    <input
                        type="file"
                        id="doc-upload-multi"
                        accept=".pdf,.docx"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    <div className="p-4 bg-primary-base/10 rounded-full group-hover:bg-primary-base/20 transition-colors mb-3">
                        <UploadCloud className="size-8 text-primary-base" />
                    </div>
                    <p className="font-medium text-text-base text-sm">
                        點擊或拖曳上傳 PDF / Word (.docx) 考卷
                    </p>
                    <p className="text-xs text-text-muted mt-1">支援同時上傳多個檔案，AI 將併發處理</p>
                </label>
            </div>

            {/* RIGHT: Progress panel */}
            <div className="card p-4 space-y-3 max-h-[400px] overflow-y-auto">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-base">處理進度</h3>
                    {jobs.length > 0 && (
                        <button
                            onClick={clearCompletedJobs}
                            className="text-[11px] text-text-muted hover:text-primary-base transition-colors flex items-center gap-1"
                        >
                            <X className="size-3" />
                            清除已完成
                        </button>
                    )}
                </div>

                {jobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-text-muted text-xs gap-2">
                        <UploadCloud className="size-6 opacity-30" />
                        上傳檔案後，進度會顯示在這裡
                    </div>
                ) : (
                    jobs.map((job) => <JobProgressRow key={job.id} job={job} onCancel={handleCancelJob} />)
                )}
            </div>
        </div>
    )
}
