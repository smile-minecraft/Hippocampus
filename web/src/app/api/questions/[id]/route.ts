/**
 * GET    /api/questions/[id] — Get single question
 * PUT    /api/questions/[id] — Update question (MODERATOR+)
 * DELETE /api/questions/[id] — Soft-delete question (MODERATOR+)
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { UpdateQuestionSchema } from "@/lib/schemas";

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

    const { tagIds, ...questionData } = parsed.data;

    const updated = await db.$transaction(async (tx) => {
        // Update question scalar fields (if any provided)
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

    return Res.ok({ id: updated.id, stem: updated.stem, updatedAt: updated.updatedAt });
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
