/**
 * @file store/uiSlice.ts
 * Zustand persist slice for user UI preferences.
 *
 * Hydration safety:
 *   - `skipHydration: true` prevents the store from reading localStorage
 *     during SSR, avoiding React hydration mismatch errors.
 *   - Consumers MUST use `useIsHydrated()` and provide a safe SSR default.
 *   - `useStore.persist.rehydrate()` is called once in AppProviders after mount.
 *
 * Persistence scope: only `theme`, `sidebarCollapsed`, `fontSizeScale`
 * are persisted. Transient UI state (e.g. modal open) is never written to disk.
 */

import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type Theme = 'dark' | 'light' | 'system'

export interface LLMStatus {
    healthy: boolean;
    latencyMs: number;
    lastCheck: string;
    error?: string;
    model?: string;
    availableModels?: string[];
}

export interface UISlice {
    // Persisted
    theme: Theme
    sidebarCollapsed: boolean
    fontSizeScale: number   // 0.8 – 1.4, step 0.1

    // Transient (not persisted)
    llmStatus: LLMStatus

    // Actions
    setTheme: (theme: Theme) => void
    toggleSidebar: () => void
    setFontScale: (scale: number) => void
    setLLMStatus: (status: LLMStatus) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUIStore = create<UISlice>()(
    subscribeWithSelector(
        persist(
            immer((set) => ({
                // ---- Defaults (also used as SSR values via useIsHydrated guard) ----
                theme: 'system',
                sidebarCollapsed: false,
                fontSizeScale: 1.0,

                // ---- Transient state (not persisted) ----
                llmStatus: {
                    healthy: false,
                    latencyMs: 0,
                    lastCheck: '',
                },

                // ---- Actions ----
                setTheme: (theme) =>
                    set((state) => {
                        state.theme = theme
                    }),

                toggleSidebar: () =>
                    set((state) => {
                        state.sidebarCollapsed = !state.sidebarCollapsed
                    }),

                setFontScale: (scale) =>
                    set((state) => {
                        // Clamp to valid range — defensive against external callers
                        state.fontSizeScale = Math.max(0.8, Math.min(1.4, scale))
                    }),

                setLLMStatus: (status) =>
                    set((state) => {
                        state.llmStatus = status
                    }),
            })),
            {
                name: 'hippocampus-ui-prefs',
                // ⚠️ Critical: do NOT hydrate during SSR. AppProviders calls
                // useUIStore.persist.rehydrate() after the first client paint.
                skipHydration: true,
                // Only persist the user-configurable fields
                partialize: (state) => ({
                    theme: state.theme,
                    sidebarCollapsed: state.sidebarCollapsed,
                    fontSizeScale: state.fontSizeScale,
                }),
            },
        ),
    ),
)
