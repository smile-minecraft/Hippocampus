/**
 * @file lib/apiClient.ts
 * Typed fetch wrapper for all Agent B API endpoints.
 *
 * Responsibilities (Agent C boundary):
 *  - Provide a strongly-typed, centralized HTTP client
 *  - Handle JSON parsing + discriminated-union error shaping
 *  - Expose fetch functions consumed by TanStack Query hooks
 *
 * Agent B is responsible for implementing all Route Handlers.
 * Agent C only calls them; never accesses the database directly.
 */

import type {
    ApiResponse,
    Question,
    WikiArticle,
    QuizFilter,
    PresignedUrlPayload,
    UploadBindPayload,
    Attempt,
} from '@/types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_API_URL
    ?? (typeof window !== 'undefined' ? '' : 'http://localhost:3000')

async function fetchApi<T>(
    path: string,
    init?: RequestInit,
): Promise<T> {
    const url = `${BASE_URL}${path}`
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...init?.headers },
        ...init,
    })

    // Treat non-2xx as structured errors
    const json = (await res.json()) as ApiResponse<T>

    if (!res.ok || !json.ok) {
        const error = json as { ok: false; code: string; message: string }
        throw new ApiClientError(
            error.code ?? 'UNKNOWN_ERROR',
            error.message ?? `HTTP ${res.status}`,
            res.status,
        )
    }

    return (json as { ok: true; data: T }).data
}

// ---------------------------------------------------------------------------
// Error class — carry structured context for error boundaries
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly statusCode: number,
    ) {
        super(message)
        this.name = 'ApiClientError'
    }
}

// ---------------------------------------------------------------------------
// Quiz endpoints
// ---------------------------------------------------------------------------

export async function fetchQuestions(filter: QuizFilter = {}): Promise<Question[]> {
    const params = new URLSearchParams()
    if (filter.tagSlugs?.length) params.set('tags', filter.tagSlugs.join(','))
    if (filter.difficulty?.length) params.set('difficulty', filter.difficulty.join(','))
    if (filter.limit) params.set('limit', String(filter.limit))

    return fetchApi<Question[]>(`/api/questions?${params}`)
}

export async function submitAttempt(payload: {
    questionId: string
    userAnswer: "A" | "B" | "C" | "D"
}): Promise<Attempt> {
    return fetchApi<Attempt>('/api/attempts', {
        method: 'POST',
        body: JSON.stringify(payload),
    })
}

// ---------------------------------------------------------------------------
// Wiki endpoints
// ---------------------------------------------------------------------------

export async function fetchWikiArticle(slug: string): Promise<WikiArticle> {
    return fetchApi<WikiArticle>(`/api/wiki/${slug}`)
}

export async function fetchRelatedQuestions(slug: string): Promise<Question[]> {
    return fetchApi<Question[]>(`/api/wiki/${slug}/related`)
}

// ---------------------------------------------------------------------------
// Upload / Audit endpoints
// ---------------------------------------------------------------------------

/** Step 1 of presigned upload: obtain a temporary MinIO PUT URL */
export async function fetchPresignedUrl(filename: string): Promise<PresignedUrlPayload> {
    return fetchApi<PresignedUrlPayload>('/api/upload/presign', {
        method: 'POST',
        body: JSON.stringify({ filename }),
    })
}

/**
 * Step 2: upload the Blob directly to MinIO using the presigned PUT URL.
 * Uses XMLHttpRequest so we can track upload progress.
 */
export function uploadToMinIO(
    presignedUrl: string,
    blob: Blob,
    onProgress?: (percent: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.open('PUT', presignedUrl)
        xhr.setRequestHeader('Content-Type', blob.type || 'image/webp')

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100))
                }
            })
        }

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve()
            } else {
                reject(new Error(`MinIO PUT failed with status ${xhr.status}`))
            }
        })

        xhr.addEventListener('error', () => {
            reject(new Error('Network error during MinIO upload'))
        })

        xhr.send(blob)
    })
}

/** Step 3: notify backend to bind the object key to the question record */
export async function bindUploadToQuestion(payload: UploadBindPayload): Promise<void> {
    await fetchApi<void>('/api/upload/bind', {
        method: 'POST',
        body: JSON.stringify(payload),
    })
}
