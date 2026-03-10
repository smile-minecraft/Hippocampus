/**
 * GET /api/quiz/stats — Personal quiz statistics for the authenticated user.
 *
 * Returns:
 *  - totalAttempts: total answers submitted
 *  - totalCorrect: total correct answers
 *  - accuracy: overall accuracy percentage (0-100)
 *  - uniqueQuestions: distinct questions attempted
 *  - streakCurrent: current consecutive-correct streak across most recent answers
 *  - dueForReview: count of questions whose nextReviewAt is in the past
 *  - recentActivity: per-day attempt counts for the last 30 days
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { log } from "@/lib/logger";

export async function GET(request: NextRequest): Promise<Response> {
    const userId = request.headers.get("x-user-id");
    if (!userId) return Res.unauthorized();

    try {
        // Run aggregations in parallel
        const [
            aggregates,
            uniqueCount,
            dueCount,
            recentActivity,
        ] = await Promise.all([
            // 1. Total attempts and correct count
            db.userQuestionRecord.aggregate({
                where: { userId, deletedAt: null },
                _count: { id: true },
                _sum: { repetitions: true },
            }),
            // 2. Unique questions attempted
            db.userQuestionRecord.groupBy({
                by: ['questionId'],
                where: { userId, deletedAt: null },
            }),
            // 3. Questions due for review (nextReviewAt in the past)
            db.userQuestionRecord.count({
                where: {
                    userId,
                    deletedAt: null,
                    nextReviewAt: { lte: new Date() },
                },
            }),
            // 4. Recent activity: per-day counts for last 30 days (raw SQL for date grouping)
            db.$queryRaw<Array<{ day: string; count: bigint }>>`
                SELECT
                    TO_CHAR("answeredAt", 'YYYY-MM-DD') AS day,
                    COUNT(*) AS count
                FROM "UserQuestionRecord"
                WHERE "userId" = ${userId}::uuid
                  AND "deletedAt" IS NULL
                  AND "answeredAt" >= NOW() - INTERVAL '30 days'
                GROUP BY day
                ORDER BY day ASC
            `,
        ]);

        // Calculate accuracy from a separate query since aggregate doesn't support conditional counting
        const correctCount = await db.userQuestionRecord.count({
            where: { userId, deletedAt: null, isCorrect: true },
        });

        const totalAttempts = aggregates._count.id;
        const accuracy = totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0;

        // Calculate current streak: count consecutive correct answers from most recent
        let streakCurrent = 0;
        const recentRecords = await db.userQuestionRecord.findMany({
            where: { userId, deletedAt: null },
            select: { isCorrect: true },
            orderBy: { answeredAt: 'desc' },
            take: 100,  // Check at most last 100
        });
        for (const r of recentRecords) {
            if (r.isCorrect) streakCurrent++;
            else break;
        }

        return Res.ok({
            totalAttempts,
            totalCorrect: correctCount,
            accuracy,
            uniqueQuestions: uniqueCount.length,
            streakCurrent,
            dueForReview: dueCount,
            recentActivity: recentActivity.map(r => ({
                day: r.day,
                count: Number(r.count),
            })),
        });
    } catch (err) {
        log.error('quiz-stats', 'Failed to fetch stats', {
            error: err instanceof Error ? err.message : String(err),
        });
        return Res.internal("無法載入統計資料");
    }
}
