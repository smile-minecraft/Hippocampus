import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";

const MergeTagsSchema = z.object({
    sourceTagId: z.string().uuid("來源標籤 ID 無效"),
    targetTagId: z.string().uuid("目標標籤 ID 無效"),
});

export async function POST(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest(" Body 必須是 JSON "); }

    const parsed = MergeTagsSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { sourceTagId, targetTagId } = parsed.data;

    if (sourceTagId === targetTagId) {
        return Res.badRequest("來源標籤和目標標籤不能相同");
    }

    try {
        await db.$transaction(async (tx) => {
            // --- 1. 處理 QuestionTag 衝突 ---
            const sourceQTags = await tx.questionTag.findMany({
                where: { tagId: sourceTagId },
                select: { questionId: true }
            });

            if (sourceQTags.length > 0) {
                const sourceQIds = sourceQTags.map(sq => sq.questionId);
                // 找出哪些已經也有 targetTagId 了 (衝突集)
                const conflictQTags = await tx.questionTag.findMany({
                    where: {
                        tagId: targetTagId,
                        questionId: { in: sourceQIds }
                    },
                    select: { questionId: true }
                });
                const conflictQIds = conflictQTags.map(cq => cq.questionId);

                // 解除衝突：將兩者皆有的題目身上的 sourceTagId 關聯直接刪除
                if (conflictQIds.length > 0) {
                    await tx.questionTag.deleteMany({
                        where: {
                            tagId: sourceTagId,
                            questionId: { in: conflictQIds }
                        }
                    });
                }

                // 轉移剩餘：將剩下沒有衝突的題目，把 tagId 換成 targetTagId
                await tx.questionTag.updateMany({
                    where: { tagId: sourceTagId },
                    data: { tagId: targetTagId }
                });
            }

            // --- 2. 處理 WikiTag 衝突 ---
            const sourceWTags = await tx.wikiTag.findMany({
                where: { tagId: sourceTagId },
                select: { wikiArticleId: true }
            });

            if (sourceWTags.length > 0) {
                const sourceWIds = sourceWTags.map(sw => sw.wikiArticleId);
                const conflictWTags = await tx.wikiTag.findMany({
                    where: {
                        tagId: targetTagId,
                        wikiArticleId: { in: sourceWIds }
                    },
                    select: { wikiArticleId: true }
                });
                const conflictWIds = conflictWTags.map(cw => cw.wikiArticleId);

                if (conflictWIds.length > 0) {
                    await tx.wikiTag.deleteMany({
                        where: {
                            tagId: sourceTagId,
                            wikiArticleId: { in: conflictWIds }
                        }
                    });
                }

                await tx.wikiTag.updateMany({
                    where: { tagId: sourceTagId },
                    data: { tagId: targetTagId }
                });
            }

            // --- 3. 抹除來源本體 ---
            await tx.tag.delete({ where: { id: sourceTagId } });

        }, {
            // 配置 30 秒超時，防止巨量資料庫鎖定導致的事務崩潰
            timeout: 30000
        });

        // 成功完成，回傳告知前端可以觸發 invalidateQueries
        return Res.ok({ message: "標籤合併成功" });

    } catch (err) {
        console.error("Tags Merge Transaction Failed:", err);
        return Res.internal("標籤合併過程中發生錯誤，已回滾");
    }
}
