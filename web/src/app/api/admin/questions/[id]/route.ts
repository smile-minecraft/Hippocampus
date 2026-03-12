import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { UpdateQuestionSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "ADMIN" && role !== "MODERATOR") {
        return Res.forbidden("無權限編輯題目");
    }

    const { id } = await context.params;

    try {
        const body = await request.json();
        const parsed = UpdateQuestionSchema.safeParse(body);

        if (!parsed.success) {
            return Res.badRequest("無效的更新載荷：" + parsed.error.errors[0].message);
        }

        // Check if question exists and is not soft-deleted
        const existing = await db.question.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
            return Res.notFound("查無此題目，或是已被刪除");
        }

        const { tagIds, ...questionData } = parsed.data;

        // Update with transactional wrapper to prevent concurrency race conditions
        const updated = await db.$transaction(async (tx) => {
            const q = Object.keys(questionData).length > 0
                ? await tx.question.update({ where: { id }, data: questionData })
                : await tx.question.findUniqueOrThrow({ where: { id } });

            // Replace tags if tagIds was explicitly provided
            if (tagIds !== undefined) {
                await tx.questionTag.deleteMany({ where: { questionId: id } });
                if (tagIds.length > 0) {
                    await tx.questionTag.createMany({
                        data: tagIds.map((tagId) => ({ questionId: id, tagId })),
                        skipDuplicates: true,
                    });
                }
            }

            return q;
        });

        return Res.ok(updated);
    } catch (e: unknown) {
        log.error('admin', 'Question update failed', { questionId: id, error: e instanceof Error ? e.message : String(e) });
        return Res.internal("更新題目時發生伺服器錯誤");
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "ADMIN" && role !== "MODERATOR") {
        return Res.forbidden("無權限刪除題目");
    }

    const { id } = await context.params;

    try {
        // Soft-delete the question
        await db.question.update({
            where: { id },
            data: { deletedAt: new Date() }
        });

        return Res.ok({ message: "題目已成功軟刪除" });
    } catch (e: unknown) {
        log.error('admin', 'Question deletion failed', { questionId: id, error: e instanceof Error ? e.message : String(e) });
        const prismaError = e as { code?: string };
        if (prismaError.code === 'P2025') {
            return Res.notFound("查無此題目");
        }
        return Res.internal("刪除題目時發生伺服器錯誤");
    }
}
