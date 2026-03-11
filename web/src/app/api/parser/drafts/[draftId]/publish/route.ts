import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { log } from "@/lib/logger";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ draftId: string }> }
) {
    try {
        // Enforce basic auth (ideally replaced by middleware context, but checking role here if accessible)
        const role = request.headers.get("x-user-role");
        if (role && role !== "ADMIN" && role !== "MODERATOR") {
            return NextResponse.json({ ok: false, error: "無權限執行匯入作業" }, { status: 403 });
        }

        const { draftId } = await context.params;

        const draft = await db.parsedDraft.findUnique({
            where: { id: draftId },
        });

        if (!draft) {
            return NextResponse.json({ ok: false, error: "查無此草稿" }, { status: 404 });
        }

        if (draft.status === "APPROVED") {
            return NextResponse.json({ ok: false, error: "此草稿已經匯入過，不可重複匯入" }, { status: 400 });
        }

        const draftData = draft.draftJson as { questions?: Array<{ stem?: string; options?: Record<string, string>; answer?: string; explanation?: string; imagePlaceholders?: string[]; tagSlugs?: string[] }>; metadata?: { year?: number | string; examType?: string } };
        if (!draftData || !Array.isArray(draftData.questions)) {
            return NextResponse.json({ ok: false, error: "草稿資料格式異常，無法匯入" }, { status: 400 });
        }

        // Try reading body for manual overrides
        let bodyOverrides: { year?: string | number; examType?: string } = {};
        try {
            bodyOverrides = await request.json();
        } catch { /* body may be empty */ }

        const metadata = draftData.metadata || {};
        const yearOverride = bodyOverrides.year ? parseInt(String(bodyOverrides.year), 10) : undefined;
        const year = yearOverride !== undefined ? yearOverride : (metadata.year ? parseInt(String(metadata.year), 10) : null);

        const examType = bodyOverrides.examType !== undefined ? bodyOverrides.examType : (metadata.examType || null);

        // Perform transactional insertion
        const questions = draftData.questions ?? [];
        await db.$transaction(async (tx) => {
            for (const q of questions) {
                // 1. Insert question
                const newQuestion = await tx.question.create({
                    data: {
                        year,
                        examType,
                        stem: q.stem || "",
                        options: q.options || {},
                        answer: q.answer || "A",
                        explanation: q.explanation || null,
                        imageUrls: q.imagePlaceholders || [], // Treat placeholders as image URLs for now (or store appropriately)
                        difficulty: q.difficulty ?? 1, // Use AI-estimated difficulty, fallback to 1
                    },
                });

                // 2. Insert tags if specified (look up by slug)
                if (Array.isArray(q.tagSlugs) && q.tagSlugs.length > 0) {
                    const tags = await tx.tag.findMany({
                        where: { slug: { in: q.tagSlugs } },
                        select: { id: true },
                    });
                    if (tags.length > 0) {
                        await tx.questionTag.createMany({
                            data: tags.map((tag: { id: string }) => ({
                                questionId: newQuestion.id,
                                tagId: tag.id,
                            })),
                            skipDuplicates: true,
                        });
                    }
                }
            }

            // 3. Mark draft as APPROVED
            await tx.parsedDraft.update({
                where: { id: draftId },
                data: {
                    status: "APPROVED",
                },
            });
        });

        return NextResponse.json({ ok: true, data: { status: "APPROVED" } });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "發生未知錯誤";
        log.error('parser', 'Draft publish failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, error: message },
            { status: 500 }
        );
    }
}
