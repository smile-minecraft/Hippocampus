/**
 * PATCH /api/questions/[id]/tags — Add/remove tags from a single question
 *
 * Request body: { add?: string[], remove?: string[] }
 * - add: array of tag slugs to add
 * - remove: array of tag slugs to remove
 *
 * Returns: Updated question with tags
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { ManageQuestionTagsSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(
    request: NextRequest,
    { params }: RouteParams
): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") {
        return Res.forbidden("需要版主或管理員權限");
    }

    const { id } = await params;

    const existing = await db.question.findFirst({
        where: { id, deletedAt: null },
    });
    if (!existing) {
        return Res.notFound("題目不存在");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = ManageQuestionTagsSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { add = [], remove = [] } = parsed.data;

    if (add.length === 0 && remove.length === 0) {
        return Res.badRequest("add 和 remove 陣列皆為空");
    }

    try {
        const result = await db.$transaction(async (tx) => {
            if (remove.length > 0) {
                const tagsToRemove = await tx.tag.findMany({
                    where: { slug: { in: remove } },
                    select: { id: true },
                });

                if (tagsToRemove.length > 0) {
                    await tx.questionTag.deleteMany({
                        where: {
                            questionId: id,
                            tagId: { in: tagsToRemove.map((t: { id: string }) => t.id) },
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
                    await tx.questionTag.createMany({
                        data: tagsToAdd.map((t: { id: string }) => ({
                            questionId: id,
                            tagId: t.id,
                        })),
                        skipDuplicates: true,
                    });
                }
            }

            return tx.question.findUnique({
                where: { id },
                select: {
                    id: true,
                    stem: true,
                    updatedAt: true,
                    tags: {
                        select: {
                            tag: {
                                select: {
                                    id: true,
                                    name: true,
                                    slug: true,
                                    dimension: true,
                                    groupName: true,
                                },
                            },
                        },
                    },
                },
            });
        });

        return Res.ok({
            id: result?.id,
            stem: result?.stem,
            updatedAt: result?.updatedAt,
            tags: result?.tags.map((t) => t.tag) ?? [],
        });
    } catch (err: unknown) {
        log.error("questions", "Tag management failed", {
            questionId: id,
            error: err instanceof Error ? err.message : String(err),
        });
        return Res.internal("標籤管理操作失敗");
    }
}