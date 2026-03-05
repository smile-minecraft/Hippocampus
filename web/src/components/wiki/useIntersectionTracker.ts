'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseIntersectionTrackerOptions {
    /** Called when a new section is the dominant visible element */
    onSectionChange: (slug: string) => void
    /** Debounce delay in ms (default: 250) */
    debounceMs?: number
}

/**
 * Tracks which article section is currently most visible in the viewport
 * using IntersectionObserver, calling `onSectionChange` debounced.
 *
 * Usage:
 *   const { rootRef } = useIntersectionTracker({ onSectionChange })
 *   // Attach rootRef to article wrapper; each <section data-slug="..."> is observed.
 *
 * Performance design:
 *   - Only ONE IntersectionObserver instance is created and reused.
 *   - Debounce prevents API floods during fast scrolling.
 *   - `useCallback` with empty deps ensures the observer callback has stable
 *     identity — the timer is managed via ref to avoid stale closures.
 *
 * Edge cases:
 *   - Rapid scroll: timer is cleared and reset; only the final stable section fires.
 *   - Component unmount: observer is disconnected and timer is cleared.
 *   - Multiple sections equally visible: the one with highest `intersectionRatio` wins.
 */
export function useIntersectionTracker({
    onSectionChange,
    debounceMs = 250,
}: UseIntersectionTrackerOptions) {
    const rootRef = useRef<HTMLElement | null>(null)
    const observerRef = useRef<IntersectionObserver | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const callbackRef = useRef(onSectionChange)

    // Keep callback ref fresh without triggering observer re-creation
    useEffect(() => {
        callbackRef.current = onSectionChange
    })

    const handleIntersections = useCallback(
        (entries: IntersectionObserverEntry[]) => {
            // Find the entry with the highest intersection ratio that is still visible
            const topEntry = entries
                .filter((e) => e.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

            if (!topEntry) return

            const slug = (topEntry.target as HTMLElement).dataset.slug
            if (!slug) return

            // Debounce: clear pending timer, schedule new callback
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
                callbackRef.current(slug)
            }, debounceMs)
        },
        [debounceMs],
    )

    // Attach observer to all data-slug sections inside rootRef
    const observeSections = useCallback(() => {
        if (!rootRef.current || observerRef.current) return

        observerRef.current = new IntersectionObserver(handleIntersections, {
            root: null,            // viewport
            rootMargin: '-20% 0px -60% 0px',  // trigger when section is in upper 40% of viewport
            threshold: [0, 0.25, 0.5, 0.75, 1],
        })

        const sections = rootRef.current.querySelectorAll<HTMLElement>('[data-slug]')
        sections.forEach((el) => observerRef.current!.observe(el))
    }, [handleIntersections])

    useEffect(() => {
        observeSections()

        return () => {
            observerRef.current?.disconnect()
            observerRef.current = null
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [observeSections])

    return { rootRef }
}
