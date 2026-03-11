'use client'

import { useEffect, useCallback } from 'react'
import { useUIStore, type LLMStatus } from '@/store'
import { useIsHydrated } from '@/hooks/useIsHydrated'
import { Circle, WifiOff, Loader2 } from 'lucide-react'

const POLL_INTERVAL_MS = 30_000

/** Normalize an error value (string, object, or unknown) to a display string. */
function normalizeError(err: unknown): string | undefined {
    if (err == null) return undefined
    if (typeof err === 'string') return err
    if (typeof err === 'object') {
        const obj = err as Record<string, unknown>
        // Middleware returns { code, message }
        if (typeof obj.message === 'string') return obj.message
        if (typeof obj.code === 'string') return obj.code
    }
    return String(err)
}

async function fetchHealth(): Promise<LLMStatus> {
    try {
        const res = await fetch('/api/llm/health', {
            cache: 'no-store',
        })
        const data = await res.json()

        // Middleware 401 returns { success: false, error: { code, message } }
        if (!res.ok && data?.success === false) {
            return {
                healthy: false,
                latencyMs: 0,
                lastCheck: new Date().toISOString(),
                error: normalizeError(data.error) ?? `HTTP ${res.status}`,
            }
        }

        return {
            healthy: data.healthy ?? false,
            latencyMs: data.latencyMs ?? 0,
            lastCheck: data.timestamp ?? new Date().toISOString(),
            error: normalizeError(data.error),
            model: data.model,
            availableModels: data.availableModels,
        }
    } catch (err) {
        return {
            healthy: false,
            latencyMs: 0,
            lastCheck: new Date().toISOString(),
            error: err instanceof Error ? err.message : 'Network error',
        }
    }
}

export function LLMStatusBar() {
    const isHydrated = useIsHydrated()
    const llmStatus = useUIStore((s) => s.llmStatus)
    const setLLMStatus = useUIStore((s) => s.setLLMStatus)

    const pollHealth = useCallback(async () => {
        const status = await fetchHealth()
        setLLMStatus(status)
    }, [setLLMStatus])

    useEffect(() => {
        if (!isHydrated) return
        pollHealth()
        const interval = setInterval(pollHealth, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
    }, [isHydrated, pollHealth])

    if (!isHydrated) {
        return (
            <div className="fixed bottom-0 left-0 right-0 h-8 bg-bg-base border-t border-border flex items-center px-4 text-xs text-text-muted">
                <div className="w-4 h-4 rounded-full bg-muted animate-pulse" />
            </div>
        )
    }

    const isLoading = !llmStatus.lastCheck
    const isHealthy = llmStatus.healthy

    const statusText = isHealthy
        ? `AI 服務正常${llmStatus.latencyMs > 0 ? ` (${llmStatus.latencyMs}ms)` : ''}`
        : `AI 服務離線${llmStatus.error ? `: ${llmStatus.error}` : ''}`

    return (
        <div className="fixed bottom-0 left-0 right-0 h-8 bg-bg-base border-t border-border flex items-center justify-between px-4 text-xs select-none z-50">
            <div className="flex items-center gap-2">
                {isLoading ? (
                    <>
                        <Loader2 className="size-3 animate-spin text-text-muted" />
                        <span className="text-text-muted">正在檢查 AI 服務...</span>
                    </>
                ) : isHealthy ? (
                    <>
                        <Circle className="size-2 fill-green-500 text-green-500" />
                        <span className="text-green-600 dark:text-green-400">{statusText}</span>
                    </>
                ) : (
                    <>
                        <WifiOff className="size-3 text-red-500" />
                        <span className="text-red-600 dark:text-red-400">{statusText}</span>
                    </>
                )}
            </div>

            <div className="flex items-center gap-3 text-text-muted">
                {llmStatus.lastCheck && (
                    <span>
                        最後更新:{' '}
                        {new Date(llmStatus.lastCheck).toLocaleTimeString('zh-TW')}
                    </span>
                )}
            </div>
        </div>
    )
}
