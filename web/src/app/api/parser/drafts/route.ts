/**
 * /api/parser/drafts
 * GET  — Returns ParsedDraft records (for AuditWorkstation display)
 * PATCH — Updates a draft's draftJson (for inline editing)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { z } from "zod";

// ---------------------------------------------------------------------------
// GET /api/parser/drafts
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10), 50);
        const statusFilter = searchParams.get("status") ?? "AWAITING_REVIEW";

        const drafts = await db.parsedDraft.findMany({
            where: {
                status: statusFilter as any,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });

        return NextResponse.json({ ok: true, data: drafts });
    } catch (err) {
        console.error("[API /parser/drafts GET] Error:", err);
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}

// ---------------------------------------------------------------------------
// PATCH /api/parser/drafts
// ---------------------------------------------------------------------------
const PatchSchema = z.object({
    draftId: z.string().uuid(),
    draftJson: z.any(),
});

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

        const { draftId, draftJson } = validation.data;

        const updated = await db.parsedDraft.update({
            where: { id: draftId },
            data: { draftJson },
        });

        return NextResponse.json({ ok: true, data: { id: updated.id, status: updated.status } });
    } catch (err) {
        console.error("[API /parser/drafts PATCH] Error:", err);
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}
