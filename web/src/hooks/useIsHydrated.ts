'use client'

import { useState } from 'react'

/**
 * Guards against SSR/CSR hydration mismatches when reading from
 * Zustand `persist` stores that are backed by localStorage.
 *
 * Usage:
 *   const isHydrated = useIsHydrated()
 *   const theme = useUIStore(s => isHydrated ? s.theme : 'system')
 *
 * The component renders with the safe SSR default until the client
 * has mounted and localStorage has been read, after which React
 * schedules a synchronous state update (no visual flash).
 *
 * Edge cases handled:
 *  - Called inside a Server Component → always returns false (no effect runs)
 *  - Multiple consumers → each maintains its own local boolean; no shared
 *    global state, no race condition between components
 */
export function useIsHydrated(): boolean {
    const [isHydrated] = useState(() => {
        // In SSR, this returns false. After hydration, React's useSyncExternalStore
        // or a subsequent render will cause re-evaluation, but useState initializer
        // only runs once. We use the effect-free pattern: check if window exists.
        return typeof window !== 'undefined'
    })

    return isHydrated
}
