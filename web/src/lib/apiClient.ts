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
    Tag,
} from '@/types'
import { buildLoginRedirect, dispatchAppNavigation } from '@/lib/navigation'

export type {
    ApiResponse,
    Question,
    WikiArticle,
    QuizFilter,
    PresignedUrlPayload,
    UploadBindPayload,
    Attempt,
    Tag,
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
    } catch (_e) {
        // Refresh failed completely — redirect to login
    }

        // If we reach here, refresh failed. Redirect to login for browser requests.
        if (typeof window !== 'undefined') {
            const currentPath = window.location.pathname + window.location.search
            if (currentPath !== '/login' && currentPath !== '/register') {
                dispatchAppNavigation({
                    path: buildLoginRedirect(currentPath),
                    replace: true,
                })
                // Throw to prevent further execution
                throw new ApiClientError('UNAUTHORIZED', '登入已過期，正在重新導向...', 401)
            }
        }
    }

    // Treat non-2xx as structured errors by reading as text first to avoid JSON parse crashes
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
        // Not a JSON response, likely an HTML error page or plain text from middleware
        throw new ApiClientError(
            'UNKNOWN_ERROR',
            text.slice(0, 100) || `HTTP ${res.status}`,
            res.status,
        )
    }

    if (!res.ok || !json.ok) {
        const error = json as { ok: false; code?: string; message?: string; error?: string | { message: string; code?: string } }
        let msg = `HTTP ${res.status}`

        if (error.message) msg = error.message
        else if (typeof error.error === 'string') msg = error.error
        else if (error.error && typeof error.error === 'object' && 'message' in error.error) msg = String(error.error.message)

        const errorCode = error.code
            ?? (typeof error.error === 'object' && error.error !== null ? error.error.code : undefined)
            ?? 'UNKNOWN_ERROR'

        throw new ApiClientError(
            errorCode,
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

interface PaginatedQuestions {
    questions: Question[]
    pagination: { total: number; page: number; limit: number; totalPages: number }
}

export async function fetchQuestions(filter: QuizFilter = {}): Promise<Question[]> {
    const params = new URLSearchParams()
    if (filter.tagSlugs?.length) params.set('tagSlugs', filter.tagSlugs.join(','))
    if (filter.difficulty?.length) params.set('difficulty', filter.difficulty.join(','))
    if (filter.limit) params.set('limit', String(filter.limit))

    const result = await fetchApi<PaginatedQuestions>(`/api/questions?${params}`)
    return result.questions
}

export async function submitAttempt(payload: {
    questionId: string
    userAnswer: number  // 0-3 index matching ["A","B","C","D"]
}): Promise<Attempt> {
    return fetchApi<Attempt>('/api/attempts', {
        method: 'POST',
        body: JSON.stringify(payload),
    })
}

/** Adaptive spaced-repetition: fetch one optimally-weighted question */
export interface NextQuestionResponse {
    id: string
    stem: string
    options: Record<string, string>
    explanation: null        // withheld until answer is submitted
    imageUrls: string[]
    priorityScore: number
}

export async function fetchNextQuestion(tagSlugs?: string[]): Promise<NextQuestionResponse> {
    const params = new URLSearchParams()
    if (tagSlugs?.length) params.set('tagSlugs', tagSlugs.join(','))
    return fetchApi<NextQuestionResponse>(`/api/quiz/next?${params}`)
}

/** Semantic search via pgvector embeddings */
export interface SearchResult {
    id: string
    stem: string
    similarity: number
}

export async function searchQuestions(query: string, tagSlugs?: string[], topK = 10): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, topK: String(topK) })
    if (tagSlugs?.length) params.set('tagSlugs', tagSlugs.join(','))
    return fetchApi<SearchResult[]>(`/api/search?${params}`)
}

/** Fetch user's attempt history (paginated) */
export interface AttemptRecord {
    id: string
    questionId: string
    userAnswer: string
    isCorrect: boolean
    easeFactor: number
    interval: number
    repetitions: number
    nextReviewAt: string
    answeredAt: string
    question: {
        id: string
        stem: string
        answer: string
        difficulty: number
        year: number | null
        examType: string | null
    }
}

export interface PaginatedAttempts {
    records: AttemptRecord[]
    pagination: { total: number; page: number; limit: number; totalPages: number }
}

export async function fetchAttemptHistory(page = 1, limit = 20, isCorrect?: boolean): Promise<PaginatedAttempts> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (isCorrect !== undefined) params.set('isCorrect', String(isCorrect))
    return fetchApi<PaginatedAttempts>(`/api/attempts?${params}`)
}

/** Fetch personal quiz statistics */
export interface QuizStats {
    totalAttempts: number
    totalCorrect: number
    accuracy: number            // 0-100
    uniqueQuestions: number
    streakCurrent: number
    dueForReview: number
    recentActivity: Array<{ day: string; count: number }>
}

export async function fetchQuizStats(): Promise<QuizStats> {
    return fetchApi<QuizStats>('/api/quiz/stats')
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
    data: Array<{
        id: string;
        name: string;
        slug: string;
        dimension: string;
        groupName: string | null;
        _count: { questions: number };
    }>;
    meta: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchAdminTags(page = 1, limit = 50, search = '', dimension = ''): Promise<AdminTagListResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.append('search', search);
    if (dimension) params.append('dimension', dimension);
    return fetchApi<AdminTagListResponse>(`/api/admin/tags?${params.toString()}`);
}

export async function createAdminTag(payload: CreateTagPayload): Promise<{ data: AdminTagListResponse['data'][number] }> {
    // POST /api/tags handles tag creation with MODERATOR+ role check and cache invalidation
    return fetchApi<{ data: AdminTagListResponse['data'][number] }>('/api/tags', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateAdminTag(id: string, payload: Partial<CreateTagPayload>): Promise<{ data: AdminTagListResponse['data'][number] }> {
    return fetchApi<{ data: AdminTagListResponse['data'][number] }>(`/api/admin/tags?id=${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
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

export async function updateQuestionTags(id: string, payload: { add?: string[]; remove?: string[] }): Promise<{ id: string; stem: string; updatedAt: string; tags: Tag[] }> {
    return fetchApi<{ id: string; stem: string; updatedAt: string; tags: Tag[] }>(`/api/questions/${id}/tags`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

export interface BatchUpdateTagsPayload {
    questionIds: string[];
    add: string[];
    remove: string[];
}

export interface BatchUpdateTagsResponse {
    ok: boolean;
    affectedCount: number;
}

export async function batchUpdateQuestionTags(payload: BatchUpdateTagsPayload): Promise<BatchUpdateTagsResponse> {
    return fetchApi<BatchUpdateTagsResponse>('/api/questions/batch/tags', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

// ---------------------------------------------------------------------------
// Admin User Management
// ---------------------------------------------------------------------------

export interface AdminUser {
    id: string;
    email: string;
    name: string | null;
    role: 'USER' | 'MODERATOR' | 'ADMIN';
    createdAt: string;
    _count: { questionRecords: number };
}

export interface AdminUserListResponse {
    users: AdminUser[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
}

export async function fetchAdminUsers(page = 1, limit = 20, search = ''): Promise<AdminUserListResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.append('search', search);
    return fetchApi<AdminUserListResponse>(`/api/admin/users?${params.toString()}`);
}

export async function updateAdminUserRole(userId: string, role: 'USER' | 'MODERATOR' | 'ADMIN'): Promise<{ id: string; email: string; role: string }> {
    return fetchApi<{ id: string; email: string; role: string }>(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
    });
}
