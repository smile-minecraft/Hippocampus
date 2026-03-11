import { TopNav } from '@/components/ui/TopNav'

/**
 * (main) route group layout — wraps all authenticated pages with TopNav.
 * Pages under this layout: /, /quiz/**, /wiki/**, /audit/**, /profile
 * Pages NOT under this layout: /login, /register
 */
export default function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <>
            <TopNav />
            {children}
        </>
    )
}
