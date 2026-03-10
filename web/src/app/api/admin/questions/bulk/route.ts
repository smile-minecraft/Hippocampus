import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";

import { z } from "zod";
import { log } from "@/lib/logger";

const BulkDeleteSchema = z.object({
    questionIds: z.array(z.string().uuid()).min(1, "請至少選擇一題"),
});

const BulkTransferSchema = z.object({
    questionIds: z.array(z.string().uuid()).min(1, "請至少選擇一題"),
    newYear: z.number().int().min(1900).max(2100).optional(),
    newExamType: z.string().min(1).max(100).optional(),
}).refine(data => data.newYear !== undefined || data.newExamType !== undefined, {
    message: "必須提供新年份或新考卷名稱其一才能轉移",
});

export async function DELETE(req: NextRequest) {
    try {
        const role = req.headers.get("x-user-role");
        if (role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "權限不足" }, { status: 403 });
        }

        const body = await req.json();
        const { questionIds } = BulkDeleteSchema.parse(body);

        // Soft delete the selected questions
        const result = await db.question.updateMany({
            where: {
                id: { in: questionIds },
                deletedAt: null
            },
            data: {
                deletedAt: new Date()
            }
        });

        return NextResponse.json({
            ok: true,
            message: `成功將 ${result.count} 題標記為刪除`
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ ok: false, code: "VALIDATION_FAILED", message: error.errors[0].message }, { status: 400 });
        }
        log.error('admin', 'Bulk delete failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "批次刪除失敗" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const role = req.headers.get("x-user-role");
        if (role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "權限不足" }, { status: 403 });
        }

        const body = await req.json();
        const { questionIds, newYear, newExamType } = BulkTransferSchema.parse(body);

        // Execute as a safe transaction that can be rolled back if anything goes wrong
        const result = await db.$transaction(async (tx) => {

            // Build the update payload
            const updateData: Record<string, unknown> = {};
            if (newYear !== undefined) updateData.year = newYear;
            if (newExamType !== undefined) updateData.examType = newExamType;

            const res = await tx.question.updateMany({
                where: {
                    id: { in: questionIds },
                    deletedAt: null // Ensure we don't accidentally revive or change deleted questions
                },
                data: updateData
            });

            return res;
        });

        return NextResponse.json({
            ok: true,
            message: `成功將 ${result.count} 題轉移至 ${newYear || '不變'} ${newExamType || '不變'}`
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ ok: false, code: "VALIDATION_FAILED", message: error.errors[0].message }, { status: 400 });
        }
        log.error('admin', 'Bulk transfer failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "批次轉移失敗" }, { status: 500 });
    }
}
