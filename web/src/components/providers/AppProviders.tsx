'use client'

import { type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getQueryClient } from '@/lib/queryClient'
import { useUIStore } from '@/store'

interface AppProvidersProps {
    children: ReactNode
}

/**
 * AppProviders mounts all client-side singletons.
 *
 * Ordering matters:
 *  1. QueryClientProvider — provides TanStack Query context
 *  2. ZustandRehydrator  — deferred localStorage sync after first paint
 *  3. ThemeApplicator    — reads theme from store and applies data-theme attr
 *
 * This component is explicitly 'use client' so it can be imported inside
 * the Server Component root layout without error.
 */
export function AppProviders({ children }: AppProvidersProps) {
    const queryClient = getQueryClient()

    return (
        <QueryClientProvider client={queryClient}>
            <ZustandRehydrator />
            <ThemeApplicator />
            {children}
        </QueryClientProvider>
    )
}

// ---------------------------------------------------------------------------
// Internal: trigger Zustand persist rehydration from localStorage
// ---------------------------------------------------------------------------

/**
 * Calls `rehydrate()` once after the first client paint.
 * This is the safe entry point for Zustand persist with skipHydration: true.
 * Renders nothing — purely a side-effect component.
 */
function ZustandRehydrator() {
    useEffect(() => {
        // Trigger all persist stores that opted into skipHydration
        void useUIStore.persist.rehydrate()
    }, [])

    return null
}

// ---------------------------------------------------------------------------
// Internal: apply theme attribute to <html> element
// ---------------------------------------------------------------------------

function ThemeApplicator() {
    const theme = useUIStore((s) => s.theme)

    useEffect(() => {
        const root = document.documentElement
        const resolvedTheme =
            theme === 'system'
                ? window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? 'dark'
                    : 'light'
                : theme

        root.setAttribute('data-theme', resolvedTheme)
        root.classList.toggle('dark', resolvedTheme === 'dark')
        root.classList.toggle('light', resolvedTheme === 'light')
    }, [theme])

    return null
}
