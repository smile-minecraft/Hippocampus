'use client'

import { useState, useCallback } from 'react'
import { ImageCropCanvas } from './ImageCropCanvas'
import { cn } from '@/lib/cn'
import { CheckCircle } from 'lucide-react'

interface AuditTask {
    imageUrl: string
    questionId: string
    placeholder: string
}

interface DraftEditorProps {
    task: AuditTask
    onBound: (objectUrl: string) => void
}

/**
 * Draft editor panel — right side of the audit workstation.
 * Shows the placeholder that needs to be filled and coordinates
 * the upload pipeline via ImageCropCanvas.
 */
export function DraftEditor({ task, onBound }: DraftEditorProps) {
    const [boundUrl, setBoundUrl] = useState<string | null>(null)

    const handleSuccess = useCallback(
        (objectUrl: string) => {
            setBoundUrl(objectUrl)
            onBound(objectUrl)
        },
        [onBound],
    )

    return (
        <div className="space-y-5">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    待替換佔位符
                </p>
                <code className="text-sm text-amber-300 font-mono bg-amber-500/10 rounded px-2 py-1 block">
                    {task.placeholder}
                </code>
            </div>

            {boundUrl ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <CheckCircle className="size-5 text-emerald-400 flex-shrink-0" aria-hidden />
                    <div className="space-y-1">
                        <p className="text-sm text-emerald-300 font-medium">上傳成功</p>
                        <p className="text-xs text-emerald-400/70 font-mono break-all">{boundUrl}</p>
                    </div>
                </div>
            ) : (
                <ImageCropCanvas
                    imageUrl={task.imageUrl}
                    questionId={task.questionId}
                    placeholder={task.placeholder}
                    onSuccess={handleSuccess}
                />
            )}
        </div>
    )
}
