'use client'

import { useState, useEffect } from 'react'

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
    const [isHydrated, setIsHydrated] = useState(false)

    useEffect(() => {
        setIsHydrated(true)
    }, [])

    return isHydrated
}
