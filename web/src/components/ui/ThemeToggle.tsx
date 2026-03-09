'use client'

import { useUIStore } from '@/store'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useIsHydrated } from '@/hooks/useIsHydrated'

export function ThemeToggle() {
    const isHydrated = useIsHydrated()
    const { theme, setTheme } = useUIStore()

    if (!isHydrated) {
        // Render a placeholder with the same dimensions during SSR to prevent layout shift
        return <div className="size-8 rounded-lg" />
    }

    const cycleTheme = () => {
        if (theme === 'system') setTheme('light')
        else if (theme === 'light') setTheme('dark')
        else setTheme('system')
    }

    return (
        <button
            onClick={cycleTheme}
            className="flex items-center justify-center size-8 rounded-lg text-text-muted hover:text-text-base hover:bg-bg-base transition-colors duration-200"
            title={`切換主題模式 (目前: ${theme === 'system' ? '跟隨系統' : theme === 'dark' ? '深色' : '淺色'})`}
        >
            {theme === 'system' && <Monitor className="size-4" />}
            {theme === 'light' && <Sun className="size-4" />}
            {theme === 'dark' && <Moon className="size-4" />}
        </button>
    )
}
