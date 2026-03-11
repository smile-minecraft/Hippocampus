import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore, type LLMStatus } from '../uiSlice'

// ---------------------------------------------------------------------------
// Setup — reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
    const { setState } = useUIStore
    // Reset to initial state
    setState({
        theme: 'system',
        sidebarCollapsed: false,
        fontSizeScale: 1.0,
        llmStatus: { healthy: false, latencyMs: 0, lastCheck: '' },
    })
})

// ---------------------------------------------------------------------------
// setTheme
// ---------------------------------------------------------------------------

describe('setTheme', () => {
    it('sets theme to dark', () => {
        useUIStore.getState().setTheme('dark')
        expect(useUIStore.getState().theme).toBe('dark')
    })

    it('sets theme to light', () => {
        useUIStore.getState().setTheme('light')
        expect(useUIStore.getState().theme).toBe('light')
    })

    it('sets theme to system', () => {
        useUIStore.getState().setTheme('dark')
        useUIStore.getState().setTheme('system')
        expect(useUIStore.getState().theme).toBe('system')
    })
})

// ---------------------------------------------------------------------------
// toggleSidebar
// ---------------------------------------------------------------------------

describe('toggleSidebar', () => {
    it('toggles from false to true', () => {
        expect(useUIStore.getState().sidebarCollapsed).toBe(false)
        useUIStore.getState().toggleSidebar()
        expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    })

    it('toggles back to false', () => {
        useUIStore.getState().toggleSidebar()
        useUIStore.getState().toggleSidebar()
        expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// setFontScale (clamped 0.8 – 1.4)
// ---------------------------------------------------------------------------

describe('setFontScale', () => {
    it('sets a valid scale value', () => {
        useUIStore.getState().setFontScale(1.2)
        expect(useUIStore.getState().fontSizeScale).toBe(1.2)
    })

    it('clamps below minimum (0.8)', () => {
        useUIStore.getState().setFontScale(0.5)
        expect(useUIStore.getState().fontSizeScale).toBe(0.8)
    })

    it('clamps above maximum (1.4)', () => {
        useUIStore.getState().setFontScale(2.0)
        expect(useUIStore.getState().fontSizeScale).toBe(1.4)
    })

    it('accepts exact boundary 0.8', () => {
        useUIStore.getState().setFontScale(0.8)
        expect(useUIStore.getState().fontSizeScale).toBe(0.8)
    })

    it('accepts exact boundary 1.4', () => {
        useUIStore.getState().setFontScale(1.4)
        expect(useUIStore.getState().fontSizeScale).toBe(1.4)
    })

    it('clamps negative values to 0.8', () => {
        useUIStore.getState().setFontScale(-1)
        expect(useUIStore.getState().fontSizeScale).toBe(0.8)
    })
})

// ---------------------------------------------------------------------------
// setLLMStatus
// ---------------------------------------------------------------------------

describe('setLLMStatus', () => {
    it('sets the LLM status object', () => {
        const status: LLMStatus = {
            healthy: true,
            latencyMs: 123,
            lastCheck: '2026-03-11T10:00:00Z',
            model: 'gpt-4o',
        }
        useUIStore.getState().setLLMStatus(status)
        expect(useUIStore.getState().llmStatus).toEqual(status)
    })

    it('replaces previous status entirely', () => {
        useUIStore.getState().setLLMStatus({
            healthy: true,
            latencyMs: 100,
            lastCheck: '2026-01-01',
            model: 'old-model',
            error: 'old error',
        })
        useUIStore.getState().setLLMStatus({
            healthy: false,
            latencyMs: 0,
            lastCheck: '2026-03-11',
        })
        const result = useUIStore.getState().llmStatus
        expect(result.healthy).toBe(false)
        // error and model should be gone since the whole object was replaced
        expect(result.error).toBeUndefined()
        expect(result.model).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
    it('has sensible defaults', () => {
        const state = useUIStore.getState()
        expect(state.theme).toBe('system')
        expect(state.sidebarCollapsed).toBe(false)
        expect(state.fontSizeScale).toBe(1.0)
        expect(state.llmStatus.healthy).toBe(false)
    })
})
