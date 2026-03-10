import { describe, it, expect } from 'vitest'
import {
    RegisterSchema,
    LoginSchema,
    GetQuestionsSchema,
    CreateQuestionSchema,
    SubmitAttemptSchema,
    SearchSchema,
    CreateTagSchema,
    PatchRoleSchema,
    PresignUploadSchema,
} from '../schemas'

// ---------------------------------------------------------------------------
// RegisterSchema
// ---------------------------------------------------------------------------

describe('RegisterSchema', () => {
    it('accepts valid registration', () => {
        const result = RegisterSchema.safeParse({
            email: 'user@example.com',
            password: 'Passw0rd',
            name: 'Alice',
        })
        expect(result.success).toBe(true)
    })

    it('rejects invalid email', () => {
        const result = RegisterSchema.safeParse({
            email: 'not-an-email',
            password: 'Passw0rd',
        })
        expect(result.success).toBe(false)
    })

    it('rejects password without uppercase', () => {
        const result = RegisterSchema.safeParse({
            email: 'a@b.com',
            password: 'password1',
        })
        expect(result.success).toBe(false)
    })

    it('rejects password without digit', () => {
        const result = RegisterSchema.safeParse({
            email: 'a@b.com',
            password: 'Abcdefgh',
        })
        expect(result.success).toBe(false)
    })

    it('rejects password shorter than 8 characters', () => {
        const result = RegisterSchema.safeParse({
            email: 'a@b.com',
            password: 'Pa1',
        })
        expect(result.success).toBe(false)
    })

    it('allows name to be omitted', () => {
        const result = RegisterSchema.safeParse({
            email: 'a@b.com',
            password: 'Passw0rd',
        })
        expect(result.success).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// LoginSchema
// ---------------------------------------------------------------------------

describe('LoginSchema', () => {
    it('accepts valid login', () => {
        const result = LoginSchema.safeParse({
            email: 'a@b.com',
            password: 'x',
        })
        expect(result.success).toBe(true)
    })

    it('rejects empty password', () => {
        const result = LoginSchema.safeParse({
            email: 'a@b.com',
            password: '',
        })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// GetQuestionsSchema
// ---------------------------------------------------------------------------

describe('GetQuestionsSchema', () => {
    it('applies defaults for page and limit', () => {
        const result = GetQuestionsSchema.parse({})
        expect(result.page).toBe(1)
        expect(result.limit).toBe(20)
    })

    it('coerces string page to number', () => {
        const result = GetQuestionsSchema.parse({ page: '3', limit: '50' })
        expect(result.page).toBe(3)
        expect(result.limit).toBe(50)
    })

    it('accepts tagSlugs and difficulty as comma-separated strings', () => {
        const result = GetQuestionsSchema.parse({
            tagSlugs: 'anatomy,physiology',
            difficulty: '1,3,5',
        })
        expect(result.tagSlugs).toBe('anatomy,physiology')
        expect(result.difficulty).toBe('1,3,5')
    })

    it('rejects limit above 100', () => {
        const result = GetQuestionsSchema.safeParse({ limit: '200' })
        expect(result.success).toBe(false)
    })

    it('rejects page < 1', () => {
        const result = GetQuestionsSchema.safeParse({ page: '0' })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// CreateQuestionSchema
// ---------------------------------------------------------------------------

describe('CreateQuestionSchema', () => {
    const validQuestion = {
        stem: '下列何者正確？',
        options: { A: '1', B: '2', C: '3', D: '4' },
        answer: 'A' as const,
    }

    it('accepts minimal valid question', () => {
        const result = CreateQuestionSchema.safeParse(validQuestion)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.difficulty).toBe(1) // default
            expect(result.data.imageUrls).toEqual([]) // default
        }
    })

    it('rejects empty stem', () => {
        const result = CreateQuestionSchema.safeParse({ ...validQuestion, stem: '' })
        expect(result.success).toBe(false)
    })

    it('rejects invalid answer letter', () => {
        const result = CreateQuestionSchema.safeParse({ ...validQuestion, answer: 'E' })
        expect(result.success).toBe(false)
    })

    it('rejects options with extra key', () => {
        const result = CreateQuestionSchema.safeParse({
            ...validQuestion,
            options: { A: '1', B: '2', C: '3', D: '4', E: '5' },
        })
        expect(result.success).toBe(false)
    })

    it('rejects difficulty outside 1-5', () => {
        const result = CreateQuestionSchema.safeParse({ ...validQuestion, difficulty: 6 })
        expect(result.success).toBe(false)
    })

    it('rejects non-URL imageUrls', () => {
        const result = CreateQuestionSchema.safeParse({
            ...validQuestion,
            imageUrls: ['not-a-url'],
        })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// SubmitAttemptSchema
// ---------------------------------------------------------------------------

describe('SubmitAttemptSchema', () => {
    it('accepts valid attempt with numeric userAnswer', () => {
        const result = SubmitAttemptSchema.safeParse({
            questionId: '550e8400-e29b-41d4-a716-446655440000',
            userAnswer: 2,
        })
        expect(result.success).toBe(true)
    })

    it('rejects userAnswer above 3', () => {
        const result = SubmitAttemptSchema.safeParse({
            questionId: '550e8400-e29b-41d4-a716-446655440000',
            userAnswer: 4,
        })
        expect(result.success).toBe(false)
    })

    it('rejects userAnswer below 0', () => {
        const result = SubmitAttemptSchema.safeParse({
            questionId: '550e8400-e29b-41d4-a716-446655440000',
            userAnswer: -1,
        })
        expect(result.success).toBe(false)
    })

    it('rejects non-UUID questionId', () => {
        const result = SubmitAttemptSchema.safeParse({
            questionId: 'not-a-uuid',
            userAnswer: 0,
        })
        expect(result.success).toBe(false)
    })

    it('rejects string userAnswer (was the Phase 4a bug)', () => {
        const result = SubmitAttemptSchema.safeParse({
            questionId: '550e8400-e29b-41d4-a716-446655440000',
            userAnswer: 'A',
        })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// SearchSchema
// ---------------------------------------------------------------------------

describe('SearchSchema', () => {
    it('accepts valid search with defaults', () => {
        const result = SearchSchema.parse({ q: 'mitosis' })
        expect(result.topK).toBe(10) // default
    })

    it('rejects empty query string', () => {
        const result = SearchSchema.safeParse({ q: '' })
        expect(result.success).toBe(false)
    })

    it('rejects topK above 50', () => {
        const result = SearchSchema.safeParse({ q: 'test', topK: '51' })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// CreateTagSchema
// ---------------------------------------------------------------------------

describe('CreateTagSchema', () => {
    it('accepts valid tag', () => {
        const result = CreateTagSchema.safeParse({
            name: '解剖學',
            slug: 'anatomy',
            dimension: 'ACADEMIC',
        })
        expect(result.success).toBe(true)
    })

    it('rejects slug with uppercase letters', () => {
        const result = CreateTagSchema.safeParse({
            name: 'Test',
            slug: 'Invalid-Slug',
            dimension: 'ACADEMIC',
        })
        expect(result.success).toBe(false)
    })

    it('rejects slug with spaces', () => {
        const result = CreateTagSchema.safeParse({
            name: 'Test',
            slug: 'has space',
            dimension: 'ACADEMIC',
        })
        expect(result.success).toBe(false)
    })

    it('rejects invalid dimension', () => {
        const result = CreateTagSchema.safeParse({
            name: 'Test',
            slug: 'test',
            dimension: 'INVALID',
        })
        expect(result.success).toBe(false)
    })

    it('accepts all four valid dimensions', () => {
        for (const dim of ['ACADEMIC', 'ORGAN', 'EXAM_CATEGORY', 'META']) {
            const result = CreateTagSchema.safeParse({
                name: 'Test',
                slug: 'test',
                dimension: dim,
            })
            expect(result.success).toBe(true)
        }
    })
})

// ---------------------------------------------------------------------------
// PatchRoleSchema
// ---------------------------------------------------------------------------

describe('PatchRoleSchema', () => {
    it('accepts valid role change', () => {
        const result = PatchRoleSchema.safeParse({
            role: 'ADMIN',
            userId: '550e8400-e29b-41d4-a716-446655440000',
        })
        expect(result.success).toBe(true)
    })

    it('rejects invalid role', () => {
        const result = PatchRoleSchema.safeParse({
            role: 'SUPERADMIN',
            userId: '550e8400-e29b-41d4-a716-446655440000',
        })
        expect(result.success).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// PresignUploadSchema
// ---------------------------------------------------------------------------

describe('PresignUploadSchema', () => {
    it('accepts valid image upload request', () => {
        const result = PresignUploadSchema.safeParse({
            filename: 'photo.png',
            contentType: 'image/png',
            sizeBytes: 1024,
        })
        expect(result.success).toBe(true)
    })

    it('rejects non-image content type', () => {
        const result = PresignUploadSchema.safeParse({
            filename: 'doc.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
        })
        expect(result.success).toBe(false)
    })

    it('rejects file over 10MB', () => {
        const result = PresignUploadSchema.safeParse({
            filename: 'big.png',
            contentType: 'image/png',
            sizeBytes: 11 * 1024 * 1024,
        })
        expect(result.success).toBe(false)
    })

    it('accepts SVG content type', () => {
        const result = PresignUploadSchema.safeParse({
            filename: 'icon.svg',
            contentType: 'image/svg+xml',
            sizeBytes: 512,
        })
        expect(result.success).toBe(true)
    })
})
