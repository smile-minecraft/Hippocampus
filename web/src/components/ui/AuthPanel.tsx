import Link from 'next/link'
import type { ReactNode } from 'react'

interface AuthPanelProps {
    eyebrow: string
    title: string
    description: string
    footer?: ReactNode
    children: ReactNode
}

export function AuthPanel({
    eyebrow,
    title,
    description,
    footer,
    children,
}: AuthPanelProps) {
    return (
        <div className="min-h-screen bg-bg-base px-4 py-8">
            <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_480px]">
                <section className="shell-panel hidden flex-col justify-between overflow-hidden px-8 py-8 lg:flex">
                    <div className="space-y-8">
                        <Link href="/" className="inline-flex items-center gap-3 text-text-base">
                            <div className="flex size-12 items-center justify-center rounded-[18px] bg-cta-base text-xl font-bold text-cta-foreground">
                                H
                            </div>
                            <div>
                                <p className="font-heading text-lg font-semibold">Hippocampus</p>
                                <p className="text-xs uppercase tracking-[0.24em] text-text-subtle">Editorial Workspace</p>
                            </div>
                        </Link>
                        <div className="space-y-4">
                            <p className="page-header-eyebrow">Notion-styled medical knowledge system</p>
                            <h1 className="font-heading text-5xl font-bold leading-tight tracking-tight text-text-base">
                                用低噪音的工作台整理題庫、知識與審核流程。
                            </h1>
                            <p className="max-w-xl text-base leading-8 text-text-muted">
                                新版介面將刷題、共筆、解析與審核收進同一個 Rose Pine 工作區裡，讓資訊密度與閱讀節奏保持平衡。
                            </p>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                        {[
                            ['Quiz', '沉浸式答題與複習'],
                            ['Wiki', '閱讀式知識共筆'],
                            ['Audit', '高密度工作站流程'],
                        ].map(([label, copy]) => (
                            <div key={label} className="section-card space-y-2 p-4">
                                <p className="text-sm font-semibold text-text-base">{label}</p>
                                <p className="text-sm leading-6 text-text-muted">{copy}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="shell-panel flex items-center px-4 py-6 sm:px-6 lg:px-8">
                    <div className="mx-auto w-full max-w-md space-y-6">
                        <div className="space-y-3">
                            <p className="page-header-eyebrow">{eyebrow}</p>
                            <h2 className="font-heading text-3xl font-bold tracking-tight text-text-base">{title}</h2>
                            <p className="text-sm leading-7 text-text-muted">{description}</p>
                        </div>
                        {children}
                        {footer ? <div className="border-t border-border-base pt-4">{footer}</div> : null}
                    </div>
                </section>
            </div>
        </div>
    )
}
