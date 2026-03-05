import { QueryClient } from '@tanstack/react-query'

/**
 * Singleton QueryClient for use in AppProviders.
 *
 * Retry strategy: exponential backoff capped at 30 s.
 * staleTime: 5 min — prevents redundant refetches when navigating between
 *   wiki articles in the dual-pane reading interface.
 * refetchOnWindowFocus: false — exam environment; focus events from switching
 *   app windows must NOT trigger silent background refetches mid-session.
 */
export function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 5 * 60 * 1000,          // 5 minutes
                gcTime: 10 * 60 * 1000,            // 10 minutes garbage collection
                retry: 3,
                retryDelay: (attempt) =>
                    Math.min(1000 * 2 ** attempt, 30_000),  // exponential, max 30 s
                refetchOnWindowFocus: false,
            },
            mutations: {
                retry: 0,                           // Mutations never auto-retry
            },
        },
    })
}

// Browser singleton — avoids creating a new client on every render
let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
    if (typeof window === 'undefined') {
        // Server: always create a fresh client (no shared state between requests)
        return makeQueryClient()
    }
    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient()
    }
    return browserQueryClient
}
