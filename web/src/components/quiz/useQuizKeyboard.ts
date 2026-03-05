'use client'

import { useEffect, useCallback, useRef } from 'react'

interface UseQuizKeyboardOptions {
    onSelectOption: (index: number) => void  // 1-4 mapped to 0-3
    onRevealOrNext: () => void               // Space / Enter
    onSkip: () => void                       // Escape
    isDisabled?: boolean                     // Disable during animations
}

/**
 * Binds global keyboard shortcuts for the immersive quiz interface.
 *
 * Keys:
 *   1-4 → select option A-D
 *   Space / Enter → reveal answer (first press) or advance to next (second)
 *   Escape → skip current question
 *
 * Safety guards:
 *   1. Checks `event.target` — keyboard shortcuts are suppressed when focus
 *      is inside any interactive form element (input, textarea, select,
 *      contenteditable). This prevents browser shortcuts from conflicting
 *      with text editing in the audit workstation.
 *   2. Checks `event.repeat` — held keys only fire once.
 *   3. Checks `event.metaKey | ctrlKey | altKey` — leaves browser/OS shortcuts
 *      (e.g. Cmd+1 for tab switching) completely unaffected.
 *   4. `isDisabled` — allows parent to pause hotkeys during Framer Motion
 *      animations so rapid keypresses don't queue up state transitions.
 *
 * Edge cases:
 *   - If the component unmounts mid-session, the cleanup removes the listener
 *     immediately, preventing stale closures from firing.
 *   - `useRef` wraps the callback options so the event listener itself is never
 *     re-registered on prop changes (stable function identity).
 */
export function useQuizKeyboard({
    onSelectOption,
    onRevealOrNext,
    onSkip,
    isDisabled = false,
}: UseQuizKeyboardOptions): void {
    // Stable ref — event listener never needs to be re-attached on callback change
    const callbacksRef = useRef({ onSelectOption, onRevealOrNext, onSkip, isDisabled })

    useEffect(() => {
        callbacksRef.current = { onSelectOption, onRevealOrNext, onSkip, isDisabled }
    })

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        const { onSelectOption, onRevealOrNext, onSkip, isDisabled } = callbacksRef.current

        // Guard: disabled or animation in progress
        if (isDisabled) return

        // Guard: focus inside an interactive / editable element
        const target = event.target as HTMLElement
        const isEditable =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement ||
            target.isContentEditable
        if (isEditable) return

        // Guard: modifier keys — never override browser/OS shortcuts
        if (event.metaKey || event.ctrlKey || event.altKey) return

        // Guard: repeated keydown events (user holding key)
        if (event.repeat) return

        switch (event.key) {
            case '1':
            case '2':
            case '3':
            case '4': {
                event.preventDefault()
                onSelectOption(Number(event.key) - 1)  // Map '1' → 0, '2' → 1 ...
                break
            }
            case ' ':
            case 'Enter': {
                event.preventDefault()
                onRevealOrNext()
                break
            }
            case 'Escape': {
                event.preventDefault()
                onSkip()
                break
            }
        }
    }, [])  // Empty deps: stable via ref

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])
}
