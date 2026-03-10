import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { log } from "@/lib/logger";

export async function GET(req: NextRequest) {
    try {
        const role = req.headers.get("x-user-role");
        if (role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "權限不足" }, { status: 403 });
        }

        // We want to list unique (year, examType) combinations and count how many active questions they have
        // Prisma groupBy allows us to do this efficiently
        const groups = await db.question.groupBy({
            by: ['year', 'examType'],
            where: {
                deletedAt: null // Only count active questions
            },
            _count: {
                id: true
            },
            orderBy: [
                { year: 'desc' },
                { examType: 'asc' }
            ]
        });

        const exams = groups.map(g => ({
            year: g.year,
            examType: g.examType,
            questionCount: g._count.id
        }));

        return NextResponse.json({ ok: true, data: exams });
    } catch (error) {
        log.error('admin', 'Get exams failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "無法取得題庫清單" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const role = req.headers.get("x-user-role");
        if (role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "權限不足" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const yearStr = searchParams.get("year");
        const examType = searchParams.get("examType");

        if (!yearStr || !examType) {
            return NextResponse.json({ ok: false, code: "MISSING_PARAMS", message: "缺少必要參數 (year, examType)" }, { status: 400 });
        }

        const year = parseInt(yearStr, 10);
        if (isNaN(year)) {
            return NextResponse.json({ ok: false, code: "INVALID_YEAR", message: "年份格式錯誤" }, { status: 400 });
        }

        // Soft delete all questions matching this year and examType
        const result = await db.question.updateMany({
            where: {
                year,
                examType,
                deletedAt: null // Only touch active ones
            },
            data: {
                deletedAt: new Date()
            }
        });

        return NextResponse.json({
            ok: true,
            message: `成功將 ${year} ${examType} 下的 ${result.count} 題標記為刪除`
        });

    } catch (error) {
        log.error('admin', 'Delete exam failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "刪除題庫失敗" }, { status: 500 });
    }
}
