'use client'

import { useUIStore } from '@/store'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useIsHydrated } from '@/hooks/useIsHydrated'

export function ThemeToggle() {
    const isHydrated = useIsHydrated()
    const { theme, setTheme } = useUIStore()

    const cycleTheme = () => {
        if (theme === 'system') setTheme('light')
        else if (theme === 'light') setTheme('dark')
        else setTheme('system')
    }

    const getTitle = () => {
        const labels: Record<string, string> = { system: '跟隨系統', light: '淺色', dark: '深色' }
        return `切換主題模式 (目前: ${labels[theme]})`
    }

    const renderIcon = () => {
        if (!isHydrated) return null
        if (theme === 'system') return <Monitor className="size-4" />
        if (theme === 'light') return <Sun className="size-4" />
        return <Moon className="size-4" />
    }

    return (
        <button
            onClick={cycleTheme}
            className="flex items-center justify-center size-8 rounded-lg text-text-muted hover:text-text-base hover:bg-bg-base transition-colors duration-200"
            title={getTitle()}
            suppressHydrationWarning
        >
            {renderIcon()}
        </button>
    )
}
