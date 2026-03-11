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

        // Fetch user records with associated questions and their tags
        const records = await db.userQuestionRecord.findMany({
            where: { userId, deletedAt: null },
            include: {
                question: {
                    include: {
                        tags: {
                            include: {
                                tag: true
                            }
                        }
                    }
                }
            }
        });

        // Calculate performance per subject (Grouped by tag name or groupName)
        const performanceMap: Record<string, { total: number; correct: number }> = {};

        for (const record of records) {
            // Find ACADEMIC tags for this question
            const academicTags = record.question.tags.filter((t: any) => t.tag.dimension === 'ACADEMIC');
            
            for (const tagRelation of academicTags) {
                const subject = tagRelation.tag.name;
                if (!performanceMap[subject]) {
                    performanceMap[subject] = { total: 0, correct: 0 };
                }
                performanceMap[subject].total += 1;
                if (record.isCorrect) {
                    performanceMap[subject].correct += 1;
                }
            }
        }

        const data = Object.entries(performanceMap).map(([subject, stats]) => ({
            subject,
            accuracy: Math.round((stats.correct / stats.total) * 100),
            total: stats.total
        }));

        // Sort by total questions descending to show most active subjects
        data.sort((a, b) => b.total - a.total);

        // If no data, return some mock data for the UI so it doesn't look empty for new users
        if (data.length === 0) {
            return Res.ok([
                { subject: "解剖學", accuracy: 0, total: 0 },
                { subject: "生理學", accuracy: 0, total: 0 },
                { subject: "藥理學", accuracy: 0, total: 0 },
                { subject: "病理學", accuracy: 0, total: 0 },
                { subject: "微生物學", accuracy: 0, total: 0 },
            ]);
        }

        return Res.ok(data.slice(0, 6)); // Return top 6 for radar chart

    } catch (error) {
        return Res.internal("無法取得表現資料");
    }
}