'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { Home, BookOpen, GraduationCap, Upload, User } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

const NAV_ITEMS = [
    { href: '/', label: '主頁', icon: Home },
    { href: '/wiki', label: '維基', icon: BookOpen },
    { href: '/quiz', label: '測驗', icon: GraduationCap },
    { href: '/audit', label: '上傳', icon: Upload },
    { href: '/profile', label: '個人', icon: User },
]

export function TopNav() {
    const pathname = usePathname()

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
                    Hippocampus
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
                                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                    isActive
                                        ? 'bg-primary-base/15 text-primary-base'
                                        : 'text-text-muted hover:text-text-base hover:bg-bg-base'
                                )}
                            >
                                <Icon className="size-4" />
                                {label}
                            </Link>
                        )
                    })}
                    <div className="w-px h-4 bg-border-base mx-1" />
                    <ThemeToggle />
                </div>
            </div>
        </nav>
    )
}
