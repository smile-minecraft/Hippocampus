import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Res } from "@/lib/api-response";

export async function GET(request: NextRequest) {
    try {
        let userId = request.headers.get("x-user-id");
        if (!userId) {
            const fallbackUser = await db.user.findFirst();
            if (!fallbackUser) return Res.unauthorized("未授權");
            userId = fallbackUser.id;
        }

        // Fetch last 14 days of activity
        const now = new Date();
        const twoWeeksAgo = new Date(now);
        twoWeeksAgo.setDate(now.getDate() - 13);
        twoWeeksAgo.setHours(0, 0, 0, 0);

        const records = await db.userQuestionRecord.findMany({
            where: { 
                userId, 
                deletedAt: null,
                answeredAt: { gte: twoWeeksAgo }
            },
            select: { answeredAt: true }
        });

        // Group by Date string
        const activityMap: Record<string, number> = {};
        
        // Initialize last 14 days with 0
        const cursor = new Date(twoWeeksAgo);
        while (cursor <= now) {
            const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            activityMap[dateStr] = 0;
            cursor.setDate(cursor.getDate() + 1);
        }

        // Count records
        for (const r of records) {
            const d = new Date(r.answeredAt);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (activityMap[dateStr] !== undefined) {
                activityMap[dateStr] += 1;
            }
        }

        const data = Object.entries(activityMap).map(([date, count]) => ({
            date,
            count
        })).sort((a, b) => a.date.localeCompare(b.date));

        return Res.ok(data);

    } catch (error) {
        return Res.internal("無法取得活動資料");
    }
}