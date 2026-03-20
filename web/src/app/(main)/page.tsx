import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BookOpen, ChartColumn, GraduationCap, ShieldCheck, Upload, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'

export const metadata: Metadata = {
  title: {
    absolute: 'Hippocampus — 醫學知識庫',
  },
  description: '醫學考古題刷題與共筆知識庫系統',
}

const modules: Array<{
  href: string
  icon: LucideIcon
  title: string
  description: string
  eyebrow: string
}> = [
  {
    href: '/quiz',
    icon: GraduationCap,
    title: '測驗系統',
    description: '保留沉浸式作答節奏，搭配鍵盤操作與複習回顧。',
    eyebrow: 'Practice',
  },
  {
    href: '/wiki',
    icon: BookOpen,
    title: '知識庫',
    description: '用閱讀式版面整理重點，並在右側追蹤關聯考題。',
    eyebrow: 'Editorial',
  },
  {
    href: '/parser',
    icon: Upload,
    title: '考卷解析',
    description: '上傳考卷後直接進入草稿工作流，從解析到發布一路收斂。',
    eyebrow: 'Ingestion',
  },
  {
    href: '/audit',
    icon: ShieldCheck,
    title: '審核工作站',
    description: '高密度校對、圖片裁切與批次操作都留在同一套 shell 內。',
    eyebrow: 'Workbench',
  },
]

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="把刷題、知識共筆與審核整理進同一個工作區。"
        description="首頁不再只是入口，而是一個編輯式儀表板。你可以從這裡進入知識庫、題目工作流與學習分析，也能在同樣的 Rose Pine 結構裡保持閱讀節奏。"
        meta={(
          <>
            <span className="pill">Notion-inspired layout</span>
            <span className="pill">Rose Pine tokens</span>
            <span className="pill">Source Han Serif</span>
          </>
        )}
      />

      <div className="page-grid-with-rail">
        <div className="space-y-6">
          <SectionCard
            title="今日工作流"
            description="以 block 的方式進入每個子系統，維持清楚的任務上下文，而不是跳進彼此風格完全不同的頁面。"
          >
            <div className="grid gap-4 md:grid-cols-2">
              {modules.map((module) => (
                <Link
                  key={module.href}
                  href={module.href}
                  className="card card-hoverable flex h-full flex-col gap-5 rounded-[24px] p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="inline-flex size-12 items-center justify-center rounded-[18px] bg-primary-muted text-primary-base">
                      <module.icon className="size-5" aria-hidden />
                    </span>
                    <span className="page-header-eyebrow">{module.eyebrow}</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-heading text-xl font-semibold text-text-base">{module.title}</h2>
                    <p className="text-sm leading-7 text-text-muted">{module.description}</p>
                  </div>
                  <div className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary-base">
                    進入模組
                    <ArrowRight className="size-4" />
                  </div>
                </Link>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="推薦起點" description="如果今天只做一件事，可以從這三個切口開始。">
            <div className="grid gap-4 lg:grid-cols-3">
              {[
                ['刷一輪短測驗', '從 10 題快速檢查今天的記憶熱點。'],
                ['補一篇 wiki', '把剛複習完的章節整理成可回讀的筆記。'],
                ['整理待審核草稿', '把 AI 解析後的草稿收斂成可發布題目。'],
              ].map(([title, copy]) => (
                <article key={title} className="rounded-[22px] border border-border-base bg-bg-surface p-4">
                  <h3 className="font-heading text-lg font-semibold text-text-base">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-text-muted">{copy}</p>
                </article>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="page-rail">
          <SectionCard title="工作區結構" description="混合式 shell 讓不同任務保留自己的密度與節奏。">
            <div className="space-y-3 text-sm leading-7 text-text-muted">
              <p>首頁、Wiki、Analytics 與 Profile 走閱讀式版面，強調區塊與節奏。</p>
              <p>Quiz、Parser 與 Audit 則保留高密度操作面，但共享相同的 header、toolbar、dialog 與 feedback 系統。</p>
            </div>
          </SectionCard>
          <SectionCard title="最近可去處" description="新版殼層裡最常用的三個區域。">
            <div className="space-y-2">
              {[
                { href: '/analytics', icon: ChartColumn, label: '學習分析' },
                { href: '/wiki', icon: BookOpen, label: '知識庫主頁' },
                { href: '/audit', icon: ShieldCheck, label: '審核工作站' },
              ].map(({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) => (
                <Link key={href} href={href} className="sidebar-link rounded-2xl border border-border-base bg-bg-surface">
                  <Icon className="size-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  )
}
