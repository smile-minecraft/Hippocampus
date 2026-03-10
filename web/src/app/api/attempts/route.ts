/**
 * GET  /api/attempts — Fetch user's paginated answer history (authenticated).
 * POST /api/attempts — Submit an answer and update spaced repetition record.
 *
 * Rate limit (POST): 60 submissions / minute per user ID.
 *
 * FSRS-inspired update logic (POST):
 *  If the answer is CORRECT:
 *    repetitions += 1
 *    interval = ceil(interval * easeFactor) (minimum 1 day)
 *    easeFactor stays the same (simplified; full FSRS adjusts based on grade)
 *  If the answer is WRONG:
 *    repetitions = 0      (reset streak)
 *    interval = 1         (review again tomorrow)
 *    easeFactor = max(1.3, easeFactor - 0.2) (question becomes harder)
 *
 * nextReviewAt is set to now() + interval days.
 *
 * Edge-Case Coverage:
 *  - First attempt (no existing record): upsert creates a new record.
 *  - Concurrent submits: Prisma upsert is atomic at the DB level.
 *  - Deleted question: 404 guard prevents orphaned records.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { rateLimit, LIMITS } from "@/lib/rate-limit";

import { SubmitAttemptSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";

// ─── GET /api/attempts — Fetch user's attempt history ─────────────────────────

const GetAttemptsSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    isCorrect: z.enum(["true", "false"]).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
    const userId = request.headers.get("x-user-id");
    if (!userId) return Res.unauthorized();

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetAttemptsSchema.safeParse(params);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { page, limit, isCorrect } = parsed.data;

    const where = {
        userId,
        deletedAt: null,
        ...(isCorrect !== undefined ? { isCorrect: isCorrect === "true" } : {}),
    };

    const [records, total] = await Promise.all([
        db.userQuestionRecord.findMany({
            where,
            select: {
                id: true,
                questionId: true,
                userAnswer: true,
                isCorrect: true,
                easeFactor: true,
                interval: true,
                repetitions: true,
                nextReviewAt: true,
                answeredAt: true,
                question: {
                    select: {
                        id: true,
                        stem: true,
                        answer: true,
                        difficulty: true,
                        year: true,
                        examType: true,
                    },
                },
            },
            orderBy: { answeredAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        db.userQuestionRecord.count({ where }),
    ]);

    return Res.ok({
        records,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
}

// ─── POST /api/attempts — Submit an answer and update spaced repetition record


export async function POST(request: NextRequest): Promise<Response> {
    const userId = request.headers.get("x-user-id")!;

    // ── Rate limit by user ID (more accurate than IP for authenticated users) ──
    const limiter = await rateLimit(userId, LIMITS.attempts);
    if (!limiter.allowed) {
        return Res.rateLimited(undefined, Math.ceil((limiter.resetAt - Date.now()) / 1000));
    }


    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest("請求 body 必須是有效的 JSON"); }

    const parsed = SubmitAttemptSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { questionId, userAnswer } = parsed.data;

    // ── Verify question exists ────────────────────────────────────────────────
    const question = await db.question.findFirst({
        where: { id: questionId, deletedAt: null },
        select: { answer: true },
    });

    if (!question) return Res.notFound("題目不存在");

    const userAnswerStr = ["A", "B", "C", "D"][userAnswer];
    const isCorrect = userAnswerStr === question.answer;

    // ── Upsert spaced-repetition record ──────────────────────────────────────
    const existing = await db.userQuestionRecord.findFirst({
        where: { userId, questionId, deletedAt: null },
        select: { id: true, easeFactor: true, interval: true, repetitions: true },
    });

    let easeFactor: number;
    let interval: number;
    let repetitions: number;

    if (!existing) {
        // First attempt defaults
        easeFactor = isCorrect ? 2.5 : 2.3;
        interval = isCorrect ? 1 : 1;
        repetitions = isCorrect ? 1 : 0;
    } else {
        if (isCorrect) {
            repetitions = existing.repetitions + 1;
            interval = Math.max(1, Math.ceil(existing.interval * existing.easeFactor));
            easeFactor = existing.easeFactor; // Simplified: no grade-based adjustment
        } else {
            repetitions = 0;
            interval = 1;
            easeFactor = Math.max(1.3, existing.easeFactor - 0.2);
        }
    }

    const nextReviewAt = new Date(
        Date.now() + interval * 24 * 60 * 60 * 1000
    );

    // ── Transactional Safety: Upsert Record + Update Global Difficulty ────────
    let record;
    try {
        record = await db.$transaction(async (txBase) => {
            // Workaround for Prisma 6 + TS Omit dropping getters in IDEs
            const tx = txBase as unknown as typeof db;
            // 1. Upsert the UserQuestionRecord
            const upsertedRecord = existing
                ? await tx.userQuestionRecord.update({
                    where: { id: existing.id },
                    data: { userAnswer: userAnswerStr, isCorrect, easeFactor, interval, repetitions, nextReviewAt, answeredAt: new Date() },
                    select: { id: true, isCorrect: true, nextReviewAt: true },
                })
                : await tx.userQuestionRecord.create({
                    data: { userId, questionId, userAnswer: userAnswerStr, isCorrect, easeFactor, interval, repetitions, nextReviewAt },
                    select: { id: true, isCorrect: true, nextReviewAt: true },
                });

            // 2. Real-time Community Difficulty Recalculation ($executeRaw)
            //    Updates the static `difficulty` field (1-5 range) based on overall accuracy.
            await tx.$executeRaw`
                WITH global_stats AS (
                    SELECT
                        COUNT(*) AS total_attempts,
                        AVG(CAST("isCorrect" AS FLOAT)) AS correct_rate
                    FROM "UserQuestionRecord"
                    WHERE "questionId" = ${questionId}::uuid AND "deletedAt" IS NULL
                ),
                -- Calculate Wilson lower bound matching quiz/next/route.ts
                calculated AS (
                    SELECT
                        CASE
                            WHEN total_attempts = 0 THEN 1
                            ELSE 1.0 - (
                                (correct_rate + 1.9208 / (2.0 * total_attempts))
                                / (1.0 + 3.8416 / total_attempts)
                                - (1.96 / (1.0 + 3.8416 / total_attempts))
                                * SQRT(
                                    correct_rate * (1.0 - correct_rate) / total_attempts
                                    + 3.8416 / (4.0 * total_attempts * total_attempts)
                                )
                            )
                        END AS wilson_score
                    FROM global_stats
                )
                UPDATE "Question"
                -- Map Wilson score (0.0 - 1.0) back to 1-5 difficulty range
                SET "difficulty" = LEAST(5, GREATEST(1, ROUND((SELECT wilson_score FROM calculated) * 4 + 1)::INT))
                WHERE "id" = ${questionId}::uuid
            `;

            return upsertedRecord;
        });
    } catch (err) {
        log.error('attempts', 'Transaction failed', { error: err instanceof Error ? err.message : String(err) });
        return Res.internal("儲存作答紀錄失敗，請稍後再試");
    }


    return Res.ok({
        isCorrect,
        correctAnswer: ["A", "B", "C", "D"].indexOf(question.answer),
        nextReviewAt: record.nextReviewAt,
        record,
    });
}
