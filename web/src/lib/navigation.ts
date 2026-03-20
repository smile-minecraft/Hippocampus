const APP_NAVIGATE_EVENT = 'hippocampus:navigate'

export interface AppNavigateDetail {
    path: string
    replace?: boolean
}

export function sanitizeInternalPath(
    path: string | null | undefined,
    fallback = '/',
): string {
    if (!path) return fallback
    if (!path.startsWith('/') || path.startsWith('//')) return fallback

    try {
        const url = new URL(path, 'http://hippocampus.local')
        if (url.origin !== 'http://hippocampus.local') return fallback
        return `${url.pathname}${url.search}${url.hash}`
    } catch {
        return fallback
    }
}

export function buildLoginRedirect(path: string): string {
    const safePath = sanitizeInternalPath(path, '/')
    return `/login?redirect=${encodeURIComponent(safePath)}`
}

export function dispatchAppNavigation(detail: AppNavigateDetail): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<AppNavigateDetail>(APP_NAVIGATE_EVENT, { detail }))
}

export function getAppNavigateEventName(): string {
    return APP_NAVIGATE_EVENT
}
