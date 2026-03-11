'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Home, RefreshCw, AlertTriangle } from 'lucide-react'

/**
 * Error boundary for the (main) route group.
 * Catches runtime errors in authenticated pages and provides a
 * retry button + navigation fallback.
 */
export default function MainErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        // Log to external error tracking in production
        console.error('[MainErrorBoundary]', error)
    }, [error])

    return (
        <main className="min-h-screen bg-bg-base flex items-center justify-center px-4">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="space-y-3">
                    <AlertTriangle className="size-12 text-amber-400 mx-auto" />
                    <h1 className="text-2xl font-heading font-bold text-text-base">
                        發生錯誤
                    </h1>
                    <p className="text-text-muted text-sm">
                        頁面載入時發生了非預期的錯誤，請嘗試重新載入
                    </p>
                    {process.env.NODE_ENV === 'development' && error.message && (
                        <pre className="mt-4 p-3 rounded-lg bg-bg-surface border border-border-base text-xs text-red-400 text-left overflow-x-auto max-h-40">
                            {error.message}
                        </pre>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-base text-white font-medium hover:bg-primary-base/90 transition-all"
                    >
                        <RefreshCw className="size-4" />
                        重新載入
                    </button>
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border-base text-text-base font-medium hover:bg-bg-surface transition-all"
                    >
                        <Home className="size-4" />
                        回到首頁
                    </Link>
                </div>
            </div>
        </main>
    )
}
