import Link from 'next/link'
import { Home, Search } from 'lucide-react'

/**
 * Custom 404 page — applies globally to all routes.
 * Renders within the root layout (no TopNav) so it works for both
 * authenticated and unauthenticated areas.
 */
export default function NotFoundPage() {
    return (
        <main className="min-h-screen bg-bg-base flex items-center justify-center px-4">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="space-y-2">
                    <p className="text-7xl font-heading font-bold text-primary-base/20">404</p>
                    <h1 className="text-2xl font-heading font-bold text-text-base">
                        找不到此頁面
                    </h1>
                    <p className="text-text-muted">
                        您請求的頁面不存在或已被移除
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-base text-white font-medium hover:bg-primary-base/90 transition-all"
                    >
                        <Home className="size-4" />
                        回到首頁
                    </Link>
                    <Link
                        href="/wiki"
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border-base text-text-base font-medium hover:bg-bg-surface transition-all"
                    >
                        <Search className="size-4" />
                        搜尋知識庫
                    </Link>
                </div>
            </div>
        </main>
    )
}
