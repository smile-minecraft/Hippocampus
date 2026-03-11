import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Res } from "@/lib/api-response";
// import { getUserFromRequest } from "@/lib/auth/server"; 

export async function GET(request: NextRequest) {
    try {
        const userId = request.headers.get("x-user-id");
        if (!userId) {
            // Development fallback for testing without auth context
            const fallbackUser = await db.user.findFirst();
            if (!fallbackUser) return Res.unauthorized("未授權");
            // return Res.unauthorized("未授權");
            request.headers.set("x-user-id", fallbackUser.id);
        }

        const actualUserId = request.headers.get("x-user-id")!;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday as start
        startOfWeek.setHours(0, 0, 0, 0);

        // 1. Total questions answered & accuracy
        const allRecords = await db.userQuestionRecord.findMany({
            where: { userId: actualUserId, deletedAt: null },
            select: { isCorrect: true, answeredAt: true }
        });

        const totalAnswered = allRecords.length;
        const correctCount = allRecords.filter((r: any) => r.isCorrect).length;
        const accuracy = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;

        // 2. Questions answered today
        const answeredToday = allRecords.filter((r: any) => new Date(r.answeredAt) >= startOfToday).length;

        // 3. Questions answered this week
        const answeredThisWeek = allRecords.filter((r: any) => new Date(r.answeredAt) >= startOfWeek).length;

        // 4. Calculate Streak (consecutive days with at least one question answered)
        const activeDates = new Set(
            allRecords.map((r: any) => {
                const d = new Date(r.answeredAt);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })
        );

        let streak = 0;
        let checkDate = new Date(startOfToday);

        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (!activeDates.has(todayStr)) {
            checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
            const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            if (activeDates.has(dateStr)) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        // 5. Spaced Repetition (Due for review today)
        const dueForReviewCount = await db.userQuestionRecord.count({
            where: {
                userId: actualUserId,
                deletedAt: null,
                nextReviewAt: { lte: now }
            }
        });

        return Res.ok({
            totalAnswered,
            accuracy: Math.round(accuracy),
            answeredToday,
            answeredThisWeek,
            streak,
            dueForReviewCount
        });

    } catch (error) {
        return Res.internal("無法取得統計資料");
    }
}