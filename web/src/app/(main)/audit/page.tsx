import type { Metadata } from 'next'
import Link from 'next/link'
import { Archive, Tags, Users } from 'lucide-react'
import { AuditWorkstation } from '@/components/audit/AuditWorkstation'
import { DocumentUploader } from '@/components/audit/DocumentUploader'
import { LLMStatusBar } from '@/components/ui/LLMStatusBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'

export const metadata: Metadata = {
    title: '審核工作站',
    description: '圖片裁切與題目草稿審核',
}

export default function AuditPage() {
    return (
        <>
            <div className="space-y-6">
                <PageHeader
                    eyebrow="Audit Workspace"
                    title="審核工作站把上傳、裁切、校對與發布接成同一條工作流。"
                    description="這裡保留高密度操作，同時用更低干擾的版面組織資訊，讓大量內容不再彼此搶焦點。"
                    actions={(
                        <>
                            <Link href="/audit/users" className="btn-secondary">
                                <Users className="size-4" />
                                用戶管理
                            </Link>
                            <Link href="/audit/tags" className="btn-secondary">
                                <Tags className="size-4" />
                                標籤管理
                            </Link>
                            <Link href="/audit/exams" className="btn-primary">
                                <Archive className="size-4" />
                                題庫管理中心
                            </Link>
                        </>
                    )}
                    meta={(
                        <>
                            <span className="pill">上傳考卷</span>
                            <span className="pill">AI 辨識</span>
                            <span className="pill">人工校對</span>
                            <span className="pill">匯入題庫</span>
                        </>
                    )}
                />

                <SectionCard
                    title="文件入口"
                    description="先上傳文件，系統會建立解析工作，再進入下方的人工審核流程。"
                >
                    <DocumentUploader />
                </SectionCard>

                <SectionCard
                    title="審核工作站"
                    description="這裡會集中顯示草稿、詳解生成與批次發布相關操作。"
                    className="!p-0 overflow-hidden"
                >
                    <div className="p-0">
                        <AuditWorkstation />
                    </div>
                </SectionCard>
            </div>
            <LLMStatusBar />
        </>
    )
}
