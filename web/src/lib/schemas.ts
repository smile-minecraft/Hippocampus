/**
 * lib/schemas.ts
 *
 * Single Source of Truth for API Payload definitions.
 * Centralizes all Zod schemas used across the application to ensure
 * exact type matching between the Frontend (Agent C) and Backend (Agent B).
 */

import { z } from "zod";

const DIMENSION_VALUES = ["ACADEMIC", "ORGAN", "EXAM_CATEGORY", "META"] as const;

// ─── Auth ───────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
    email: z
        .string()
        .email("必須是有效的電子郵件格式")
        .max(255, "電子郵件不可超過 255 字元"),
    password: z
        .string()
        .min(8, "密碼長度至少 8 個字元")
        .max(72, "密碼長度不可超過 72 字元（bcrypt 限制）")
        .regex(/[A-Z]/, "密碼必須包含至少一個大寫字母")
        .regex(/[0-9]/, "密碼必須包含至少一個數字"),
    name: z.string().min(1, "姓名不可為空").max(100).optional(),
});

export const LoginSchema = z.object({
    email: z.string().email("必須是有效的電子郵件格式"),
    password: z.string().min(1, "密碼不可為空"),
});

// ─── Questions ─────────────────────────────────────────────────────────────

export const GetQuestionsSchema = z.object({
    tagSlugs: z.string().optional(), // comma-separated
    year: z.coerce.number().int().positive().optional(),
    examType: z.string().max(50).optional(),
    difficulty: z.string().optional(), // comma-separated difficulty levels (1-5)
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const CreateQuestionSchema = z.object({
    year: z.number().int().min(1900).max(2100).optional(),
    examType: z.string().max(50).optional(),
    stem: z.string().min(1, "題幹不可為空").max(10000),
    options: z
        .object({
            A: z.string().min(1),
            B: z.string().min(1),
            C: z.string().min(1),
            D: z.string().min(1),
        })
        .strict(),
    answer: z.enum(["A", "B", "C", "D"]),
    explanation: z.string().max(20000).optional(),
    imageUrls: z.array(z.string().url()).max(10).default([]),
    difficulty: z.number().int().min(1).max(5).default(1),
    wikiArticleId: z.string().uuid().optional(),
    tagIds: z.array(z.string().uuid()).max(20).default([]),
});

export const UpdateQuestionSchema = z.object({
    stem: z.string().min(1).max(10000).optional(),
    options: z
        .object({
            A: z.string().min(1),
            B: z.string().min(1),
            C: z.string().min(1),
            D: z.string().min(1),
        })
        .strict()
        .optional(),
    answer: z.enum(["A", "B", "C", "D"]).optional(),
    explanation: z.string().max(20000).optional(),
    imageUrls: z.array(z.string().url()).max(10).optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    wikiArticleId: z.string().uuid().nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(20).optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    examType: z.string().max(50).nullable().optional(),
});

// ─── Quiz & Attempts ───────────────────────────────────────────────────────

export const QuizNextSchema = z.object({
    tagSlugs: z.string().optional(), // comma-separated tag slugs
});

export const SubmitAttemptSchema = z.object({
    questionId: z.string().uuid("必須是有效的題目 UUID"),
    userAnswer: z.number().int().min(0).max(3),
});

// ─── Search ────────────────────────────────────────────────────────────────

export const SearchSchema = z.object({
    q: z
        .string()
        .min(1, "搜尋字串不可為空")
        .max(500, "搜尋字串不可超過 500 字"),
    tagSlugs: z.string().optional(), // comma-separated for metadata pre-filter
    topK: z.coerce.number().int().min(1).max(50).default(10),
});

// ─── Tags ──────────────────────────────────────────────────────────────────

export const CreateTagSchema = z.object({
    name: z.string().min(1).max(100),
    slug: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9-]+$/, "Slug 只允許小寫字母、數字和連字號"),
    dimension: z.enum(DIMENSION_VALUES),
    groupName: z.string().max(100).optional().nullable(),
});

// Schema for managing tags on a single question (add/remove by slug)
export const ManageQuestionTagsSchema = z
    .object({
        add: z.array(z.string().min(1)).max(50).optional(),
        remove: z.array(z.string().min(1)).max(50).optional(),
    })
    .refine((data) => data.add !== undefined || data.remove !== undefined, {
        message: "必須提供 add 或 remove 陣列",
    });

// Schema for batch tag operations on multiple questions
export const BatchQuestionTagsSchema = z
    .object({
        questionIds: z
            .array(z.string().uuid("題目 ID 必須是有效的 UUID"))
            .min(1, "至少需要一個題目 ID")
            .max(100, "一次最多處理 100 個題目"),
        add: z.array(z.string().min(1)).max(50).optional(),
        remove: z.array(z.string().min(1)).max(50).optional(),
    })
    .refine((data) => (data.add?.length ?? 0) > 0 || (data.remove?.length ?? 0) > 0, {
        message: "add 和 remove 陣列皆為空",
    });

// ─── Admin Users ───────────────────────────────────────────────────────────

export const GetUsersSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(255).optional(),
});

export const PatchRoleSchema = z.object({
    role: z.enum(["USER", "MODERATOR", "ADMIN"] as const),
    userId: z.string().uuid(),
});

// ─── Upload (New in Phase 3) ───────────────────────────────────────────────

export const PresignUploadSchema = z.object({
    filename: z.string().min(1, "檔案名稱不可為空").max(255),
    contentType: z
        .string()
        .regex(/^image\/(jpeg|png|webp|gif|svg\+xml)$/, "僅允許上傳圖片格式"),
    sizeBytes: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 * 1024, "檔案大小不可超過 10MB"),
});

export const BindUploadSchema = z.object({
    questionId: z.string().uuid("必須提供有效的題目 UUID"),
    fileKey: z.string().min(1, "File Key 不可為空"),
});

export const ParserUploadSchema = z.object({
    docType: z.enum(["word", "pdf"]),
});

// ─── Type Exports ──────────────────────────────────────────────────────────

export type RegisterPayload = z.infer<typeof RegisterSchema>;
export type LoginPayload = z.infer<typeof LoginSchema>;
export type GetQuestionsQuery = z.infer<typeof GetQuestionsSchema>;
export type CreateQuestionPayload = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionPayload = z.infer<typeof UpdateQuestionSchema>;
export type QuizNextQuery = z.infer<typeof QuizNextSchema>;
export type SubmitAttemptPayload = z.infer<typeof SubmitAttemptSchema>;
export type SearchQuery = z.infer<typeof SearchSchema>;
export type CreateTagPayload = z.infer<typeof CreateTagSchema>;
export type GetUsersQuery = z.infer<typeof GetUsersSchema>;
export type PatchRolePayload = z.infer<typeof PatchRoleSchema>;
export type PresignUploadPayload = z.infer<typeof PresignUploadSchema>;
export type BindUploadPayload = z.infer<typeof BindUploadSchema>;
export type ManageQuestionTagsPayload = z.infer<typeof ManageQuestionTagsSchema>;
export type BatchQuestionTagsPayload = z.infer<typeof BatchQuestionTagsSchema>;
