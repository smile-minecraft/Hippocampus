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

export type {
    ApiResponse,
    Question,
    WikiArticle,
    QuizFilter,
    PresignedUrlPayload,
    UploadBindPayload,
    Attempt,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_API_URL
    ?? (typeof window !== 'undefined' ? '' : 'http://localhost:3000')

export async function fetchApi<T>(
    path: string,
    init?: RequestInit,
): Promise<T> {
    const url = `${BASE_URL}${path}`
    const method = init?.method ?? 'GET'
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())

    let csrfToken = ''
    if (needsCsrf && typeof document !== 'undefined') {
        const match = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
        if (match) csrfToken = match[1]
    }

    const isFormData = init?.body instanceof FormData
    const headers: Record<string, string> = {
        ...(!isFormData && { 'Content-Type': 'application/json' }),
        ...(csrfToken && { 'x-csrf-token': csrfToken }),
        ...(init?.headers as Record<string, string>),
    }

    const opts: RequestInit = {
        credentials: 'include',
        ...init,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    }

    const res = await fetch(url, opts)

    // Intercept 401s for automatic JWT refresh
    if (res.status === 401 && !(init?.headers as Record<string, string>)?.[`x-is-retry`]) {
        try {
            const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
            })

            let shouldRetry = false;
            if (refreshRes.ok) {
                shouldRetry = true;
            } else if (refreshRes.status === 409) {
                // Another tab/request is already refreshing. Backoff and retry
                await new Promise(r => setTimeout(r, 500));
                shouldRetry = true;
            }

            if (shouldRetry) {
                return fetchApi<T>(path, {
                    ...init,
                    headers: {
                        ...headers,
                        'x-is-retry': 'true',
                    }
                })
            }
        } catch (e) {
            // Proceed to throw the original 401 error if refresh fails completely
        }
    }

    // Treat non-2xx as structured errors by reading as text first to avoid JSON parse crashes
    const text = await res.text()
    let json: any = null
    try {
        json = text ? JSON.parse(text) : {}
    } catch {
        // Not a JSON response, likely an HTML error page or plain text from middleware
        throw new ApiClientError(
            'UNKNOWN_ERROR',
            text.slice(0, 100) || `HTTP ${res.status}`,
            res.status,
        )
    }

    if (!res.ok || !json.ok) {
        const error = json as { ok: false; code?: string; message?: string; error?: any }
        let msg = `HTTP ${res.status}`

        if (error.message) msg = error.message
        else if (typeof error.error === 'string') msg = error.error
        else if (error.error && typeof error.error === 'object' && 'message' in error.error) msg = String(error.error.message)

        throw new ApiClientError(
            error.code ?? (error.error?.code) ?? 'UNKNOWN_ERROR',
            msg,
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
// Tag endpoints
// ---------------------------------------------------------------------------

import { TagsResponse } from '@/types'

export async function fetchTags(): Promise<TagsResponse> {
    return fetchApi<TagsResponse>('/api/tags')
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

// ---------------------------------------------------------------------------
// Document Parser endpoints (Extraction Pipeline)
// ---------------------------------------------------------------------------

import { ParserJobResponsePayload } from '@/types'
import { ParserJobStatusPayload } from '@/app/api/parser/status/[jobId]/route'

export async function uploadParserDocument(file: File, docType: 'word' | 'pdf'): Promise<ParserJobResponsePayload> {
    const formData = new FormData()
    formData.append('docType', docType)
    formData.append('originalFilename', file.name)
    formData.append('file', file)

    return fetchApi<ParserJobResponsePayload>('/api/parser/upload', {
        method: 'POST',
        body: formData,
    })
}

export async function fetchParserJobStatus(jobId: string): Promise<ParserJobStatusPayload> {
    return fetchApi<ParserJobStatusPayload>(`/api/parser/status/${jobId}`)
}

export async function cancelParserJob(jobId: string): Promise<void> {
    await fetchApi<void>(`/api/parser/status/${jobId}`, {
        method: 'DELETE',
    })
}

export async function publishParserDraft(draftId: string): Promise<void> {
    await fetchApi<void>(`/api/parser/drafts/${draftId}/publish`, {
        method: 'POST',
    })
}

// ---------------------------------------------------------------------------
// Admin Question Bank endpoints
// ---------------------------------------------------------------------------
export interface ExamSummary {
    year: number | null;
    examType: string | null;
    questionCount: number;
}

export interface BulkTransferPayload {
    questionIds: string[];
    newYear?: number;
    newExamType?: string;
}

export async function fetchAdminExams(): Promise<ExamSummary[]> {
    return fetchApi<ExamSummary[]>('/api/admin/exams');
}

export async function deleteAdminExam(year: number, examType: string): Promise<void> {
    await fetchApi<void>(`/api/admin/exams?year=${year}&examType=${encodeURIComponent(examType)}`, {
        method: 'DELETE'
    });
}

export async function bulkDeleteQuestions(questionIds: string[]): Promise<void> {
    await fetchApi<void>('/api/admin/questions/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ questionIds })
    });
}

export async function bulkTransferQuestions(payload: BulkTransferPayload): Promise<void> {
    await fetchApi<void>('/api/admin/questions/bulk', {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

export async function fetchAdminExamQuestions(id: string): Promise<Question[]> {
    return fetchApi<Question[]>(`/api/admin/exams/${id}`);
}

// ---------------------------------------------------------------------------
// Admin: Tag Management
// ---------------------------------------------------------------------------

import { CreateTagPayload } from './schemas';

export interface AdminTagListResponse {
    data: any[]; // Contains tags with relation _count
    meta: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchAdminTags(page = 1, limit = 50, search = '', dimension = ''): Promise<AdminTagListResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.append('search', search);
    if (dimension) params.append('dimension', dimension);
    return fetchApi<AdminTagListResponse>(`/api/admin/tags?${params.toString()}`);
}

export async function createAdminTag(payload: CreateTagPayload): Promise<any> {
    return fetchApi<any>('/api/tags', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateAdminTag(id: string, payload: Partial<CreateTagPayload>): Promise<any> {
    return fetchApi<any>(`/api/admin/tags?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteAdminTag(id: string): Promise<void> {
    return fetchApi<void>(`/api/admin/tags?id=${id}`, { method: 'DELETE' });
}

export async function mergeAdminTags(sourceTagId: string, targetTagId: string): Promise<void> {
    return fetchApi<void>('/api/admin/tags/merge', {
        method: 'POST',
        body: JSON.stringify({ sourceTagId, targetTagId })
    });
}

// ---------------------------------------------------------------------------
// Admin Question Editing
// ---------------------------------------------------------------------------

export async function updateAdminQuestion(id: string, payload: Partial<Question>): Promise<Question> {
    return fetchApi<Question>(`/api/admin/questions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

export async function deleteAdminQuestion(id: string): Promise<void> {
    return fetchApi<void>(`/api/admin/questions/${id}`, {
        method: 'DELETE'
    });
}
