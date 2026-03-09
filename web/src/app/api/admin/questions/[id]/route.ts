import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { z } from "zod";

const QuestionUpdateSchema = z.object({
    stem: z.string().min(1, "題幹不能為空").optional(),
    options: z.object({
        A: z.string(),
        B: z.string(),
        C: z.string(),
        D: z.string()
    }).optional(),
    answer: z.enum(["A", "B", "C", "D"]).optional(),
    explanation: z.string().nullable().optional(),
    year: z.number().nullable().optional(),
    examType: z.string().nullable().optional()
});

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
        const parsed = QuestionUpdateSchema.safeParse(body);

        if (!parsed.success) {
            return Res.badRequest("無效的更新載荷：" + parsed.error.errors[0].message);
        }

        // Check if question exists and is not soft-deleted
        const existing = await db.question.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
            return Res.notFound("查無此題目，或是已被刪除");
        }

        // Update with transactional wrapper to prevent concurrency race conditions
        const updated = await db.$transaction(async (tx) => {
            return await tx.question.update({
                where: { id },
                data: parsed.data
            });
        });

        return Res.ok(updated);
    } catch (e: any) {
        console.error(`[PATCH /api/admin/questions/${id}]`, e);
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
    } catch (e: any) {
        console.error(`[DELETE /api/admin/questions/${id}]`, e);
        if (e.code === 'P2025') {
            return Res.notFound("查無此題目");
        }
        return Res.internal("刪除題目時發生伺服器錯誤");
    }
}
