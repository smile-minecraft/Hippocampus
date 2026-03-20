import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { BatchQuestionTagsSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";

export async function POST(request: NextRequest): Promise<Response> {
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

    const parsed = BatchQuestionTagsSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { questionIds, add = [], remove = [] } = parsed.data;

    try {
        const result = await db.$transaction(async (tx) => {
            const existingQuestions = await tx.question.findMany({
                where: {
                    id: { in: questionIds },
                    deletedAt: null,
                },
                select: { id: true },
            });

            if (existingQuestions.length === 0) {
                return { affectedCount: 0 };
            }

            const existingQuestionIds = existingQuestions.map((question: { id: string }) => question.id);

            if (remove.length > 0) {
                const tagsToRemove = await tx.tag.findMany({
                    where: { slug: { in: remove } },
                    select: { id: true },
                });

                if (tagsToRemove.length > 0) {
                    await tx.questionTag.deleteMany({
                        where: {
                            questionId: { in: existingQuestionIds },
                            tagId: { in: tagsToRemove.map((tag: { id: string }) => tag.id) },
                        },
                    });
                }
            }

            if (add.length > 0) {
                const tagsToAdd = await tx.tag.findMany({
                    where: { slug: { in: add } },
                    select: { id: true },
                });

                if (tagsToAdd.length > 0) {
                    const tagIds = tagsToAdd.map((tag: { id: string }) => tag.id);
                    const data = existingQuestionIds.flatMap((questionId: string) =>
                        tagIds.map((tagId: string) => ({
                            questionId,
                            tagId,
                        }))
                    );
                    await tx.questionTag.createMany({
                        data,
                        skipDuplicates: true,
                    });
                }
            }

            return { affectedCount: existingQuestionIds.length };
        });

        return Res.ok({ affectedCount: result.affectedCount });
    } catch (err: unknown) {
        log.error("batch-tags", "Batch tag operation failed", {
            questionIds,
            error: err instanceof Error ? err.message : String(err),
        });
        return Res.internal("批量標籤操作失敗");
    }
}
