'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/cn'
import { Home, BookOpen, GraduationCap, Upload, User, LogOut, ChevronDown, Loader2 } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

const NAV_ITEMS = [
    { href: '/', label: '主頁', icon: Home },
    { href: '/wiki', label: '維基', icon: BookOpen },
    { href: '/quiz', label: '測驗', icon: GraduationCap },
    { href: '/audit', label: '上傳', icon: Upload },
]

interface UserInfo {
    id: string
    email: string
    name: string | null
    role: string
}

export function TopNav() {
    const pathname = usePathname()
    const router = useRouter()
    const [user, setUser] = useState<UserInfo | null>(null)
    const [userLoading, setUserLoading] = useState(true)
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [loggingOut, setLoggingOut] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Fetch current user on mount
    useEffect(() => {
        let cancelled = false
        async function loadUser() {
            try {
                const res = await fetch('/api/users/me', { credentials: 'include' })
                if (!res.ok) {
                    setUser(null)
                    return
                }
                const json = await res.json()
                if (!cancelled && json.ok) {
                    setUser(json.data)
                }
            } catch {
                if (!cancelled) setUser(null)
            } finally {
                if (!cancelled) setUserLoading(false)
            }
        }
        loadUser()
        return () => { cancelled = true }
    }, [])

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
        }
        if (dropdownOpen) {
            document.addEventListener('mousedown', handleClick)
            return () => document.removeEventListener('mousedown', handleClick)
        }
    }, [dropdownOpen])

    const handleLogout = useCallback(async () => {
        setLoggingOut(true)
        try {
            // Read CSRF token from cookie
            const csrfMatch = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
            const csrfToken = csrfMatch ? csrfMatch[1] : ''

            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    ...(csrfToken && { 'x-csrf-token': csrfToken }),
                },
            })
        } catch {
            // Best-effort logout
        } finally {
            setLoggingOut(false)
            setDropdownOpen(false)
            router.push('/login')
        }
    }, [router])

    const displayName = user?.name || user?.email?.split('@')[0] || ''

    return (
        <nav className="sticky top-0 z-50 w-full border-b border-border-base bg-bg-surface/80 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
                {/* Logo */}
                <Link
                    href="/"
                    className="flex items-center gap-2 font-heading font-bold text-lg text-primary-base tracking-tight hover:opacity-80 transition-opacity"
                >
                    <span className="size-8 rounded-lg bg-primary-base/15 flex items-center justify-center text-primary-base text-sm font-bold">
                        H
                    </span>
                    <span className="hidden sm:inline">Hippocampus</span>
                </Link>

                {/* Nav tabs */}
                <div className="flex items-center gap-1">
                    {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                        const isActive =
                            href === '/' ? pathname === '/' : pathname.startsWith(href)

                        return (
                            <Link
                                key={href}
                                href={href}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                    isActive
                                        ? 'bg-primary-base/15 text-primary-base'
                                        : 'text-text-muted hover:text-text-base hover:bg-bg-base'
                                )}
                            >
                                <Icon className="size-4" />
                                <span className="hidden md:inline">{label}</span>
                            </Link>
                        )
                    })}

                    <div className="w-px h-4 bg-border-base mx-1" />
                    <ThemeToggle />

                    {/* User Menu */}
                    <div className="w-px h-4 bg-border-base mx-1" />
                    {userLoading ? (
                        <div className="size-8 rounded-lg bg-bg-base animate-pulse" />
                    ) : user ? (
                        <div className="relative" ref={dropdownRef}>
                            <button
                                onClick={() => setDropdownOpen(prev => !prev)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                    dropdownOpen || pathname === '/profile'
                                        ? 'bg-primary-base/15 text-primary-base'
                                        : 'text-text-muted hover:text-text-base hover:bg-bg-base'
                                )}
                            >
                                <User className="size-4" />
                                <span className="hidden md:inline max-w-[100px] truncate">{displayName}</span>
                                <ChevronDown className={cn('size-3 transition-transform duration-200', dropdownOpen && 'rotate-180')} />
                            </button>

                            {dropdownOpen && (
                                <div className="absolute right-0 mt-2 w-56 bg-bg-surface border border-border-base rounded-xl shadow-xl py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                                    <div className="px-4 py-3 border-b border-border-base">
                                        <p className="text-sm font-medium text-text-base truncate">{displayName}</p>
                                        <p className="text-xs text-text-muted truncate">{user.email}</p>
                                        <span className="mt-1 inline-block text-[10px] font-semibold text-primary-base bg-primary-base/10 rounded-full px-2 py-0.5">
                                            {user.role}
                                        </span>
                                    </div>
                                    <Link
                                        href="/profile"
                                        onClick={() => setDropdownOpen(false)}
                                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-text-base hover:bg-bg-base transition-colors"
                                    >
                                        <User className="size-4" />
                                        個人資料
                                    </Link>
                                    <button
                                        onClick={handleLogout}
                                        disabled={loggingOut}
                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
                                    >
                                        {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                                        登出
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <Link
                            href="/login"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-base hover:bg-bg-base transition-all duration-200"
                        >
                            <User className="size-4" />
                            <span className="hidden md:inline">登入</span>
                        </Link>
                    )}
                </div>
            </div>
        </nav>
    )
}
