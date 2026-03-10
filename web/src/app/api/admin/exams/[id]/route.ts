import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { log } from "@/lib/logger";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Format is year_examType
) {
    try {
        const role = req.headers.get("x-user-role");
        if (role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "權限不足" }, { status: 403 });
        }

        const { id } = await params;
        const [yearStr, ...examTypeParts] = id.split("_");

        if (!yearStr) {
            return NextResponse.json({ ok: false, code: "MISSING_PARAMS", message: "格式錯誤, 預期 year_examType" }, { status: 400 });
        }

        const year = parseInt(yearStr, 10);
        // decodeURIComponent because frontend routed with encodeURIComponent for examType
        const examType = decodeURIComponent(examTypeParts.join("_"));

        const questions = await db.question.findMany({
            where: {
                year: isNaN(year) ? null : year,
                examType: examType === 'NONE' ? null : examType,
                deletedAt: null // Only active questions
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        return NextResponse.json({ ok: true, data: questions });

    } catch (error) {
        log.error('admin', 'Get exam questions failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "無法取得考卷題目清單" }, { status: 500 });
    }
}
