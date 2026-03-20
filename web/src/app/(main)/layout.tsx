import { AppShell } from '@/components/ui/AppShell'

/**
 * (main) route group layout — wraps all authenticated pages with the shared app shell.
 * Pages under this layout: /, /quiz/**, /wiki/**, /audit/**, /profile
 * Pages NOT under this layout: /login, /register
 */
export default function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <AppShell>{children}</AppShell>
    )
}
