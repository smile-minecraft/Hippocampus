/**
 * GET    /api/questions/[id] — Get single question
 * PUT    /api/questions/[id] — Update question (MODERATOR+)
 * DELETE /api/questions/[id] — Soft-delete question (MODERATOR+)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";

const UpdateQuestionSchema = z.object({
    stem: z.string().min(1).max(10000).optional(),
    options: z
        .object({
            A: z.string().min(1),
            B: z.string().min(1),
            C: z.string().min(1),
            D: z.string().min(1),
        })
        .strict()
        .optional(),
    answer: z.enum(["A", "B", "C", "D"]).optional(),
    explanation: z.string().max(20000).optional(),
    imageUrls: z.array(z.string().url()).max(10).optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    wikiArticleId: z.string().uuid().nullable().optional(),
}).strict();

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
    _request: NextRequest,
    { params }: RouteParams
): Promise<Response> {
    const { id } = await params;

    const question = await db.question.findFirst({
        where: { id, deletedAt: null },
        include: {
            tags: { include: { tag: true } },
            wikiArticle: { select: { id: true, title: true } },
            _count: { select: { records: true } },
        },
    });

    if (!question) return Res.notFound("題目不存在");
    return Res.ok(question);
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(
    request: NextRequest,
    { params }: RouteParams
): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    const { id } = await params;

    const existing = await db.question.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return Res.notFound("題目不存在");

    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest("請求 body 必須是有效的 JSON"); }

    const parsed = UpdateQuestionSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    if (Object.keys(parsed.data).length === 0) {
        return Res.badRequest("請至少提供一個要更新的欄位");
    }

    const updated = await db.question.update({
        where: { id },
        data: parsed.data,
        select: { id: true, stem: true, updatedAt: true },
    });

    return Res.ok(updated);
}

// ─── DELETE (soft) ────────────────────────────────────────────────────────────

export async function DELETE(
    request: NextRequest,
    { params }: RouteParams
): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") return Res.forbidden();

    const { id } = await params;

    const existing = await db.question.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return Res.notFound("題目不存在");

    await db.question.update({
        where: { id },
        data: { deletedAt: new Date() },
    });

    return Res.ok({ message: "題目已軟刪除" });
}
