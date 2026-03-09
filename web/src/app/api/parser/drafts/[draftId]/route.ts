import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { deleteObject, BUCKETS } from "@/lib/minio/client";

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ draftId: string }> }
): Promise<Response> {
    // 1. Authorization
    const role = request.headers.get("x-user-role");
    if (role !== "ADMIN" && role !== "MODERATOR") {
        return Res.forbidden("僅管理員可刪除草稿");
    }

    const { draftId } = await context.params;

    try {
        // 2. Fetch the draft to see what needs to be deleted
        const draft = await db.parsedDraft.findUnique({
            where: { id: draftId },
        });

        if (!draft) {
            return Res.notFound("查無此草稿");
        }

        if (draft.status === "APPROVED" as any) {
            return Res.conflict("此草稿已經匯入題庫，無法被刪除");
        }

        // 3. Extract MinIO object keys from the draft (if any)
        // Original raw file (e.g., pdf or docx)
        if (draft.originalUrl) {
            try {
                // originalUrl might be a full URL, we just need the key
                // Typically MINIO_PUBLIC_URL + BUCKETS.RAW + "/" + objectKey
                const urlObj = new URL(draft.originalUrl);
                const pathParts = urlObj.pathname.split('/');
                // Remove empty strings and bucket name
                const keyParts = pathParts.filter(p => p !== '' && p !== BUCKETS.RAW && p !== BUCKETS.ASSETS);
                const objectKey = keyParts.join('/');
                if (objectKey) {
                    await deleteObject(BUCKETS.RAW, objectKey);
                }
            } catch (e) {
                console.warn(`[Draft DELETE] Failed to delete raw file from MinIO: ${draft.originalUrl}`, e);
            }
        }

        // Extracted inline images from JSON
        const draftData = draft.draftJson as any;
        if (draftData && Array.isArray(draftData.questions)) {
            for (const q of draftData.questions) {
                if (Array.isArray(q.imagePlaceholders)) {
                    for (const imgUrl of q.imagePlaceholders) {
                        try {
                            const urlObj = new URL(imgUrl);
                            const pathParts = urlObj.pathname.split('/');
                            const keyParts = pathParts.filter(p => p !== '' && p !== BUCKETS.RAW && p !== BUCKETS.ASSETS);
                            const objectKey = keyParts.join('/');
                            if (objectKey) {
                                await deleteObject(BUCKETS.ASSETS, objectKey);
                            }
                        } catch (e) {
                            console.warn(`[Draft DELETE] Failed to delete asset image from MinIO: ${imgUrl}`, e);
                        }
                    }
                }
            }
        }

        // 4. Delete the database record
        await db.parsedDraft.delete({
            where: { id: draftId },
        });

        return Res.ok({ message: "草稿與關聯檔案已成功刪除" });

    } catch (error: any) {
        console.error("[API DELETE /parser/drafts/[id]] Error:", error);
        return Res.internal("刪除草稿時發生伺服器錯誤");
    }
}
