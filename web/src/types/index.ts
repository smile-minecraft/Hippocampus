/**
 * @file types/index.ts
 * Global shared TypeScript types for Hippocampus frontend.
 * These mirror the Prisma schema shapes but are decoupled from the ORM
 * so they can be safely imported in both Server and Client Components.
 */

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Tag {
    id: string
    name: string
    slug: string
    category: string
}

export interface Question {
    id: string
    content: string        // Markdown-formatted question body
    options: string[]      // Parsed from stored JSON string: ["(A)...", ..."]
    answerIndex: number    // 0=A, 1=B, 2=C, 3=D, -1=Unknown
    explanation: string | null
    difficulty: 1 | 2 | 3 | 4 | 5
    tags: Tag[]
    createdAt: string      // ISO 8601
    updatedAt: string
}

export interface WikiArticle {
    id: string
    slug: string
    title: string
    content: string        // Raw Markdown
    publishedAt: string | null
    relatedQuestions?: Question[]
}

export interface Attempt {
    id: string
    questionId: string
    isCorrect: boolean
    userAnswer: number
    timestamp: string
}

export interface SessionStats {
    correct: number
    wrong: number
    skipped: number
}

// ---------------------------------------------------------------------------
// API response wrappers — strict discriminated union, never `any`
// ---------------------------------------------------------------------------

export type ApiSuccess<T> = {
    ok: true
    data: T
}

export type ApiError = {
    ok: false
    code: string          // Machine-readable error code, e.g. "QUESTION_NOT_FOUND"
    message: string       // Human-readable description
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ---------------------------------------------------------------------------
// Upload lifecycle types (Presigned URL flow)
// ---------------------------------------------------------------------------

export interface PresignedUrlPayload {
    presignedUrl: string  // Temporary PUT URL pointing to MinIO
    objectKey: string     // MinIO object key for subsequent binding call
    expiresAt: number     // Unix timestamp (seconds)
}

export interface UploadBindPayload {
    objectKey: string     // MinIO key returned after successful PUT
    questionId: string    // Target question to bind the image to
    placeholder: string   // e.g. "[需要手動截圖_1]" placeholder to replace
}

// ---------------------------------------------------------------------------
// Quiz session types
// ---------------------------------------------------------------------------

export type QuizFilter = {
    tagSlugs?: string[]
    difficulty?: number[]
    limit?: number
}
