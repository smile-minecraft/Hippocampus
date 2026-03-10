/**
 * GET  /api/questions   — Browse questions (public, paginated, filterable by tag/year)
 * POST /api/questions   — Create a question (MODERATOR+ only)
 *
 * Filtering strategy:
 *  - tagSlugs: comma-separated, matched via QuestionTag join
 *  - year: numeric year filter
 *  - page + limit: cursor-free offset pagination (acceptable at this scale)
 *
 * All read access is public to allow anonymous browsing.
 * Write access is role-guarded by reading x-user-role from the
 * middleware-injected header.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { log } from "@/lib/logger";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const GetQuestionsSchema = z.object({
    tagSlugs: z.string().optional(), // comma-separated
    year: z.coerce.number().int().positive().optional(),
    examType: z.string().max(50).optional(),
    difficulty: z.string().optional(), // comma-separated difficulty levels (1-5)
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateQuestionSchema = z.object({
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

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetQuestionsSchema.safeParse(params);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { tagSlugs, year, examType, difficulty, page, limit } = parsed.data;
    const tagList = tagSlugs
        ? tagSlugs.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const difficultyList = difficulty
        ? difficulty.split(",").map(Number).filter((n) => n >= 1 && n <= 5)
        : undefined;

    const where = {
        deletedAt: null,
        ...(year ? { year } : {}),
        ...(examType ? { examType } : {}),
        ...(difficultyList?.length ? { difficulty: { in: difficultyList } } : {}),
        ...(tagList?.length
            ? {
                tags: {
                    some: {
                        tag: { slug: { in: tagList } },
                    },
                },
            }
            : {}),
    };

    const [questions, total] = await Promise.all([
        db.question.findMany({
            where,
            select: {
                id: true,
                year: true,
                examType: true,
                stem: true,
                options: true,
                answer: true,
                difficulty: true,
                imageUrls: true,
                tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        db.question.count({ where }),
    ]);

    return Res.ok({
        questions,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
    // Role guard (identity injected by middleware)
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") {
        return Res.forbidden("需要版主或管理員權限");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = CreateQuestionSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { tagIds, ...data } = parsed.data;

    try {
        const question = await db.question.create({
            data: {
                ...data,
                ...(tagIds.length
                    ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
                    : {}),
            },
            select: { id: true, stem: true, year: true, createdAt: true },
        });

        return Res.created(question);
    } catch (err: unknown) {
        log.error('questions', 'Question creation failed', { error: err instanceof Error ? err.message : String(err) });
        return Res.internal();
    }
}
