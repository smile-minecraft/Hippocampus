import type { Metadata } from 'next'
import { AuditWorkstation } from '@/components/audit/AuditWorkstation'
import { DocumentUploader } from '@/components/audit/DocumentUploader'
import { TopNav } from '@/components/ui/TopNav'

export const metadata: Metadata = {
    title: '審核工作站',
    description: '圖片裁切與題目草稿審核',
}

export default function AuditPage() {
    return (
        <>
            <TopNav />
            <main className="min-h-screen bg-bg-base px-4 py-6 transition-colors duration-300">
                <div className="max-w-7xl mx-auto space-y-6">
                    <header className="flex justify-between items-center space-y-1">
                        <div>
                            <h1 className="text-2xl font-heading font-bold text-text-base">
                                審核工作站
                            </h1>
                            <p className="text-sm text-text-muted">
                                上傳考卷 → AI 自動辨識 → 人工審核校對 → 匯入題庫
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <a
                                href="/audit/tags"
                                className="inline-flex items-center px-4 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-sm font-medium shadow-sm"
                            >
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                                標籤管理
                            </a>
                            <a
                                href="/audit/exams"
                                className="inline-flex items-center px-4 py-2 bg-primary-base hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                            >
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                題庫管理中心
                            </a>
                        </div>
                    </header>

                    <DocumentUploader />
                    <AuditWorkstation />
                </div>
            </main>
        </>
    )
}
