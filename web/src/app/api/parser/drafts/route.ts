/**
 * /api/parser/drafts
 * GET  — Returns ParsedDraft records (for AuditWorkstation display)
 * PATCH — Updates a draft's draftJson and/or status (for inline editing & reject flow)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { z } from "zod";
import { log } from "@/lib/logger";

const VALID_STATUSES = ["PROCESSING", "AWAITING_REVIEW", "APPROVED", "REJECTED"] as const;

// ---------------------------------------------------------------------------
// GET /api/parser/drafts?status=AWAITING_REVIEW&limit=20
// Pass status=ALL to return all statuses
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10), 50);
        const statusParam = searchParams.get("status") ?? "AWAITING_REVIEW";

        const where = statusParam === "ALL"
            ? {}
            : { status: statusParam };

        const drafts = await db.parsedDraft.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
        });

        return NextResponse.json({ ok: true, data: drafts });
    } catch (err) {
        log.error('parser', 'Drafts GET failed', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}

// ---------------------------------------------------------------------------
// PATCH /api/parser/drafts
// Supports updating draftJson and/or status (e.g. reject with reason)
// ---------------------------------------------------------------------------
const PatchSchema = z.object({
    draftId: z.string().uuid(),
    draftJson: z.record(z.unknown()).optional(),
    status: z.enum(VALID_STATUSES).optional(),
    errorLog: z.string().max(2000).optional(),
}).refine(
    (d) => d.draftJson !== undefined || d.status !== undefined,
    { message: "至少需要提供 draftJson 或 status 其中一個欄位" }
);

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const validation = PatchSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { ok: false, error: "Invalid payload", details: validation.error.flatten() },
                { status: 400 }
            );
        }

        const { draftId, draftJson, status, errorLog } = validation.data;

        // Prevent editing APPROVED drafts
        if (draftJson) {
            const existing = await db.parsedDraft.findUnique({ where: { id: draftId }, select: { status: true } });
            if (existing?.status === "APPROVED") {
                return NextResponse.json(
                    { ok: false, error: "已核准的草稿不可再修改內容" },
                    { status: 409 }
                );
            }
        }

        const data: Record<string, unknown> = {};
        if (draftJson !== undefined) data.draftJson = draftJson;
        if (status !== undefined) data.status = status;
        if (errorLog !== undefined) data.errorLog = errorLog;

        const updated = await db.parsedDraft.update({
            where: { id: draftId },
            data,
        });

        return NextResponse.json({ ok: true, data: { id: updated.id, status: updated.status } });
    } catch (err) {
        log.error('parser', 'Drafts PATCH failed', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}
