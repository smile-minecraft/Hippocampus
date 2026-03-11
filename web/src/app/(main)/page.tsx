import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, GraduationCap, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: {
    absolute: 'Hippocampus — 醫學知識庫',
  },
  description: '醫學考古題刷題與共筆知識庫系統',
}

/**
 * Dashboard — Server Component.
 * Hub page with navigation cards to Quiz, Wiki, and Audit modules.
 * Rendered entirely on the server with zero client JS for this route.
 */
export default function DashboardPage() {
  const modules = [
    {
      href: '/quiz',
      icon: GraduationCap,
      title: '測驗模式',
      description: '沉浸式刷題，支援數字鍵快捷操作與 Framer Motion 過場動畫',
      badge: '快捷鍵支援',
    },
    {
      href: '/wiki',
      icon: BookOpen,
      title: '知識庫',
      description: '雙向聯動閱讀介面，滾動時側邊欄即時呈現關聯考古題',
      badge: '雙向聯動',
    },
    {
      href: '/audit',
      icon: ShieldCheck,
      title: '審核工作站',
      description: 'Canvas HiDPI 圖片裁切 + 預先簽章直傳 MinIO 物件儲存',
      badge: '管理員',
    },
  ]

  return (
    <main className="min-h-screen bg-bg-base px-4 py-16 md:py-24 transition-colors duration-300">
      <div className="max-w-4xl mx-auto space-y-16">
        {/* ─── Hero / Header ────────────────────────────────────────────── */}
        <header className="space-y-4 text-center">
          <h1 className="text-4xl md:text-5xl font-heading font-bold text-text-base tracking-tight">
            Hippocampus
          </h1>
          <p className="text-lg text-text-muted max-w-xl mx-auto">
            醫學考古題刷題 × 共筆知識庫 — 知識點與考題精準雙向聯動
          </p>
        </header>

        {/* ─── Module Grid ──────────────────────────────────────────────── */}
        <div className="grid md:grid-cols-3 gap-6">
          {modules.map(({ href, icon: Icon, title, description, badge }) => (
            <Link
              key={href}
              href={href}
              className="card card-hoverable p-6 space-y-4 group block outline-none"
            >
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center justify-center size-12 rounded-xl bg-primary-base/10 text-primary-base group-hover:bg-primary-base/20 transition-colors duration-300">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="text-[10px] font-semibold text-primary-base bg-primary-base/10 rounded-full px-2.5 py-1">
                  {badge}
                </span>
              </div>
              <div className="space-y-2">
                <h2 className="font-heading font-semibold text-lg text-text-base group-hover:text-primary-base transition-colors duration-300">
                  {title}
                </h2>
                <p className="text-sm text-text-muted leading-relaxed">
                  {description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
