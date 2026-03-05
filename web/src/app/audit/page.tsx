import type { Metadata } from 'next'
import { DraftEditor } from '@/components/audit/DraftEditor'
import { AuditWorkstation } from '@/components/audit/AuditWorkstation'

export const metadata: Metadata = {
    title: '審核工作站',
    description: '圖片裁切與題目草稿審核',
}

/**
 * Audit page — mostly CSR (Canvas API requires client).
 * Server Component provides the page shell; actual audit logic is deferred to
 * AuditWorkstation which is 'use client'.
 */
export default function AuditPage() {
    return (
        <main className="min-h-screen bg-zinc-950 px-4 py-10">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="space-y-1">
                    <h1 className="text-2xl font-bold text-zinc-100">審核工作站</h1>
                    <p className="text-sm text-zinc-400">
                        左側原圖拖曳框選 → 右側確認表單 → 上傳至物件儲存
                    </p>
                </header>
                <AuditWorkstation />
            </div>
        </main>
    )
}
