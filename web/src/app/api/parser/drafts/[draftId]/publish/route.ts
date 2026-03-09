import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";

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

        if (draft.status === "APPROVED" as any) {
            return NextResponse.json({ ok: false, error: "此草稿已經匯入過，不可重複匯入" }, { status: 400 });
        }

        const draftData = draft.draftJson as any;
        if (!draftData || !Array.isArray(draftData.questions)) {
            return NextResponse.json({ ok: false, error: "草稿資料格式異常，無法匯入" }, { status: 400 });
        }

        // Try reading body for manual overrides
        let bodyOverrides: any = {};
        try {
            bodyOverrides = await request.json();
        } catch { }

        const metadata = draftData.metadata || {};
        const yearOverride = bodyOverrides.year ? parseInt(bodyOverrides.year, 10) : undefined;
        const year = yearOverride !== undefined ? yearOverride : (metadata.year ? parseInt(metadata.year, 10) : null);

        const examType = bodyOverrides.examType !== undefined ? bodyOverrides.examType : (metadata.examType || null);

        // Perform transactional insertion
        await db.$transaction(async (tx) => {
            for (const q of draftData.questions) {
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
                        difficulty: 1, // Default rating
                    },
                });

                // 2. Insert tags if specified
                if (Array.isArray(q.tagIds) && q.tagIds.length > 0) {
                    await tx.questionTag.createMany({
                        data: q.tagIds.map((tagId: string) => ({
                            questionId: newQuestion.id,
                            tagId: tagId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }

            // 3. Mark draft as APPROVED
            await tx.parsedDraft.update({
                where: { id: draftId },
                data: {
                    status: "APPROVED" as any,
                },
            });
        });

        return NextResponse.json({ ok: true, data: { status: "APPROVED" } });
    } catch (error: any) {
        console.error("[API /parser/drafts/[id]/publish] Error:", error);
        return NextResponse.json(
            { ok: false, error: error.message || "發生未知錯誤" },
            { status: 500 }
        );
    }
}
