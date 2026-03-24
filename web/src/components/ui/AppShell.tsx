'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
    BookOpen,
    BrainCircuit,
    ChevronDown,
    ChartColumn,
    GraduationCap,
    Home,
    LogOut,
    Menu,
    PanelLeftClose,
    PanelLeftOpen,
    Search,
    ShieldCheck,
    Sparkles,
    Upload,
    User,
    X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUIStore } from '@/store'
import { ThemeToggle } from './ThemeToggle'
import { Button } from './Button'

interface AppShellProps {
    children: ReactNode
}

interface UserInfo {
    id: string
    email: string
    name: string | null
    role: string
}

const NAV_GROUPS = [
    {
        label: '學習與知識',
        items: [
            { href: '/', label: '首頁', icon: Home },
            { href: '/wiki', label: '知識庫', icon: BookOpen },
            { href: '/quiz', label: '測驗系統', icon: GraduationCap },
            { href: '/analytics', label: '學習分析', icon: ChartColumn },
        ],
    },
    {
        label: '工作台',
        items: [
            { href: '/parser', label: '考卷解析', icon: Upload },
            { href: '/audit', label: '審核工作站', icon: ShieldCheck },
        ],
    },
    {
        label: '帳戶',
        items: [
            { href: '/profile', label: '個人資料', icon: User },
        ],
    },
] as const

const BREADCRUMB_LABELS: Record<string, string> = {
    analytics: '學習分析',
    audit: '審核工作站',
    exams: '題庫管理',
    parser: '考卷解析',
    profile: '個人資料',
    quiz: '測驗系統',
    engine: '作答模式',
    history: '作答紀錄',
    wiki: '知識庫',
    users: '用戶管理',
    tags: '標籤管理',
    drafts: '草稿',
    list: '列表',
}

export function AppShell({ children }: AppShellProps) {
    const pathname = usePathname()
    const router = useRouter()
    const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
    const toggleSidebar = useUIStore((state) => state.toggleSidebar)
    const setSidebarCollapsed = useUIStore((state) => state.setSidebarCollapsed)
    const [user, setUser] = useState<UserInfo | null>(null)
    const [isUserLoading, setIsUserLoading] = useState(true)
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const [userMenuOpen, setUserMenuOpen] = useState(false)
    const userMenuRef = useRef<HTMLDivElement>(null)
    const userMenuButtonRef = useRef<HTMLButtonElement>(null)
    const quizCollapseStateRef = useRef<boolean | null>(null)

    useEffect(() => {
        let cancelled = false

        async function loadUser() {
            try {
                const response = await fetch('/api/users/me', { credentials: 'include' })
                if (!response.ok) {
                    if (!cancelled) setUser(null)
                    return
                }

                const json = await response.json()
                if (!cancelled && json.ok) {
                    setUser(json.data)
                }
            } catch {
                if (!cancelled) setUser(null)
            } finally {
                if (!cancelled) setIsUserLoading(false)
            }
        }

        loadUser()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        setMobileSidebarOpen(false)
    }, [pathname])

    useEffect(() => {
        if (pathname.startsWith('/quiz/engine')) {
            if (quizCollapseStateRef.current === null) {
                quizCollapseStateRef.current = sidebarCollapsed
            }
            if (!sidebarCollapsed) {
                setSidebarCollapsed(true)
            }
            return
        }

        if (quizCollapseStateRef.current !== null) {
            setSidebarCollapsed(quizCollapseStateRef.current)
            quizCollapseStateRef.current = null
        }
    }, [pathname, setSidebarCollapsed, sidebarCollapsed])

    useEffect(() => {
        if (!userMenuOpen) return

        const handlePointerDown = (event: MouseEvent) => {
            if (!userMenuRef.current?.contains(event.target as Node)) {
                setUserMenuOpen(false)
                userMenuButtonRef.current?.focus()
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setUserMenuOpen(false)
                userMenuButtonRef.current?.focus()
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [userMenuOpen])

    const breadcrumbs = useMemo(() => {
        const segments = pathname.split('/').filter(Boolean)
        const trail = [{ href: '/', label: '工作區' }]
        let current = ''

        for (const segment of segments) {
            current += `/${segment}`
            trail.push({
                href: current,
                label: BREADCRUMB_LABELS[segment] ?? decodeURIComponent(segment),
            })
        }

        return trail
    }, [pathname])

    async function handleLogout() {
        setIsLoggingOut(true)

        try {
            const csrfMatch = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
            const csrfToken = csrfMatch ? csrfMatch[1] : ''

            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
            })
        } catch {
            // Best-effort logout.
        } finally {
            setIsLoggingOut(false)
            setUserMenuOpen(false)
            router.replace('/login')
        }
    }

    const userDisplayName = user?.name || user?.email?.split('@')[0] || '帳戶'

    return (
        <div
            className={cn(
                'min-h-screen md:grid md:transition-[grid-template-columns] md:duration-300',
                sidebarCollapsed ? 'md:grid-cols-[92px_minmax(0,1fr)]' : 'md:grid-cols-[264px_minmax(0,1fr)]',
            )}
        >
            <Sidebar
                collapsed={sidebarCollapsed}
                mobileOpen={mobileSidebarOpen}
                pathname={pathname}
                onCloseMobile={() => setMobileSidebarOpen(false)}
                onToggleCollapsed={toggleSidebar}
            />
            <div className="min-w-0">
                <header className="sticky top-0 z-40 border-b border-border-base bg-surface-base/90 backdrop-blur-2xl">
                    <div className="flex h-12 items-center gap-3 px-4 md:px-6">
                        <button
                            type="button"
                            aria-label="開啟側欄"
                            onClick={() => setMobileSidebarOpen(true)}
                            className="rounded-2xl border border-border-base bg-surface-base p-2 text-text-muted shadow-sm transition-colors hover:border-border-hover hover:text-text-base md:hidden"
                        >
                            <Menu className="size-4" />
                        </button>
                        <button
                            type="button"
                            aria-label={sidebarCollapsed ? '展開側欄' : '收合側欄'}
                            onClick={toggleSidebar}
                            className="hidden rounded-2xl border border-border-base bg-surface-base p-2 text-text-muted shadow-sm transition-colors hover:border-border-hover hover:text-text-base md:inline-flex"
                        >
                            {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                        </button>

                        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
                            <ol className="flex items-center gap-2 overflow-x-auto text-sm text-text-muted">
                                {breadcrumbs.map((crumb, index) => (
                                    <li key={crumb.href} className="flex items-center gap-2 whitespace-nowrap">
                                        {index > 0 ? <span className="text-text-subtle">/</span> : null}
                                        <Link
                                            href={crumb.href}
                                            className={cn(
                                                'transition-colors hover:text-text-base',
                                                index === breadcrumbs.length - 1 && 'font-semibold text-text-base',
                                            )}
                                        >
                                            {crumb.label}
                                        </Link>
                                    </li>
                                ))}
                            </ol>
                        </nav>

                        <div className="hidden items-center gap-2 md:flex">
                            <span className="pill">
                                <Search className="size-3.5" />
                                快速切換
                            </span>
                            <ThemeToggle />
                        </div>

                        <div className="relative" ref={userMenuRef}>
                            {isUserLoading ? (
                                <div className="h-9 w-24 animate-pulse rounded-2xl bg-surface-muted" />
                            ) : user ? (
                                <>
                                    <button
                                        ref={userMenuButtonRef}
                                        type="button"
                                        aria-haspopup="menu"
                                        aria-expanded={userMenuOpen}
                                        onClick={() => setUserMenuOpen((open) => !open)}
                                        className="inline-flex items-center gap-2 rounded-2xl border border-border-base bg-surface-base px-3 py-2 text-sm text-text-base shadow-sm transition-colors hover:border-border-hover hover:bg-surface-muted"
                                    >
                                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary-muted text-xs font-semibold text-primary-base">
                                            {userDisplayName.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span className="hidden max-w-32 truncate md:inline">{userDisplayName}</span>
                                        <ChevronDown className={cn('size-4 text-text-subtle transition-transform', userMenuOpen && 'rotate-180')} />
                                    </button>
                                    {userMenuOpen ? (
                                        <div
                                            role="menu"
                                            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-56 rounded-[24px] border border-border-base bg-surface-base p-2 shadow-elevation-2 backdrop-blur-2xl"
                                        >
                                            <div className="rounded-2xl bg-bg-surface px-3 py-3">
                                                <p className="truncate text-sm font-semibold text-text-base">{userDisplayName}</p>
                                                <p className="truncate text-xs text-text-muted">{user.email}</p>
                                                <p className="mt-2 inline-flex rounded-full bg-primary-muted px-2 py-1 text-[11px] font-semibold text-primary-base">
                                                    {user.role}
                                                </p>
                                            </div>
                                            <div className="mt-2 grid gap-1">
                                                <Link
                                                    href="/profile"
                                                    role="menuitem"
                                                    onClick={() => setUserMenuOpen(false)}
                                                    className="sidebar-link"
                                                >
                                                    <User className="size-4" />
                                                    <span>個人資料</span>
                                                </Link>
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={handleLogout}
                                                    disabled={isLoggingOut}
                                                    className="sidebar-link text-danger-base hover:bg-danger-muted"
                                                >
                                                    <LogOut className="size-4" />
                                                    <span>{isLoggingOut ? '登出中...' : '登出'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <Button size="sm" variant="secondary" onClick={() => router.push('/login')}>
                                    <User className="size-4" />
                                    登入
                                </Button>
                            )}
                        </div>
                    </div>
                </header>
                <main className="shell-main">{children}</main>
            </div>
        </div>
    )
}

function Sidebar({
    collapsed,
    mobileOpen,
    pathname,
    onCloseMobile,
    onToggleCollapsed,
}: {
    collapsed: boolean
    mobileOpen: boolean
    pathname: string
    onCloseMobile: () => void
    onToggleCollapsed: () => void
}) {
    return (
        <>
            <div
                className={cn(
                    'fixed inset-y-0 left-0 z-50 w-[264px] max-w-[calc(100vw-2rem)] transform border-r border-border-base bg-surface-base px-3 py-4 backdrop-blur-2xl transition-transform duration-300 md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0 md:border-r',
                    mobileOpen ? 'translate-x-0' : '-translate-x-[110%]',
                    collapsed && 'md:px-2',
                )}
            >
                <div className="flex h-full flex-col gap-5">
                    <div className="flex items-center justify-between gap-3 px-2">
                        <Link href="/" className="flex min-w-0 items-center gap-3 text-text-base">
                            <div className="flex size-11 items-center justify-center rounded-[18px] bg-cta-base text-lg font-bold text-cta-foreground shadow-sm">
                                H
                            </div>
                            {!collapsed ? (
                                <div className="min-w-0">
                                    <p className="truncate font-heading text-lg font-semibold">Hippocampus</p>
                                    <p className="truncate text-xs tracking-[0.18em] text-text-subtle uppercase">Knowledge Workspace</p>
                                </div>
                            ) : null}
                        </Link>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                aria-label="關閉側欄"
                                onClick={onCloseMobile}
                                className="rounded-2xl border border-border-base p-2 text-text-muted transition-colors hover:border-border-hover hover:text-text-base md:hidden"
                            >
                                <X className="size-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={collapsed ? '展開側欄' : '收合側欄'}
                                onClick={onToggleCollapsed}
                                className="hidden rounded-2xl border border-border-base p-2 text-text-muted transition-colors hover:border-border-hover hover:text-text-base md:inline-flex"
                            >
                                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                            </button>
                        </div>
                    </div>

                    {!collapsed ? (
                        <div className="mx-2 rounded-[24px] border border-border-base bg-bg-surface px-4 py-4">
                            <div className="flex items-start gap-3">
                                <span className="mt-0.5 inline-flex size-10 items-center justify-center rounded-2xl bg-primary-muted text-primary-base">
                                    <Sparkles className="size-4" />
                                </span>
                                <div className="space-y-1">
                                    <p className="font-heading text-base font-semibold text-text-base">編輯式工作區</p>
                                    <p className="text-sm leading-6 text-text-muted">
                                        將刷題、共筆、審核與解析整合成一個低噪音工作流。
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="flex-1 overflow-y-auto pr-1">
                        {NAV_GROUPS.map((group) => (
                            <div key={group.label} className="mb-4 space-y-1">
                                {!collapsed ? <p className="sidebar-group-label">{group.label}</p> : null}
                                {group.items.map((item) => {
                                    const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                'sidebar-link',
                                                isActive && 'sidebar-link-active',
                                                collapsed && 'justify-center px-2',
                                            )}
                                        >
                                            <item.icon className="size-4 shrink-0" />
                                            {!collapsed ? <span>{item.label}</span> : null}
                                        </Link>
                                    )
                                })}
                            </div>
                        ))}
                    </div>

                    <div className={cn('mt-auto space-y-3 px-2', collapsed && 'px-0')}>
                        {!collapsed ? (
                            <div className="rounded-[24px] border border-border-base bg-bg-surface px-4 py-4 text-sm text-text-muted">
                                <p className="font-semibold text-text-base">Workspace Notes</p>
                                <p className="mt-2 leading-6">
                                    Quiz 保持沉浸式，Wiki 保持閱讀式，Audit 與 Parser 保持工作站密度。
                                </p>
                            </div>
                        ) : null}
                        <div className={cn('flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
                            <ThemeToggle />
                            {!collapsed ? (
                                <span className="pill">
                                    <BrainCircuit className="size-3.5" />
                                    主題已同步
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
            {mobileOpen ? (
                <button
                    type="button"
                    aria-label="關閉側欄背景"
                    onClick={onCloseMobile}
                    className="dialog-overlay fixed inset-0 z-40 md:hidden"
                />
            ) : null}
        </>
    )
}
