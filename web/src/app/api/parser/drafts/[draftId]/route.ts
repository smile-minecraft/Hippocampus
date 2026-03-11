import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { deleteObject, BUCKETS } from "@/lib/minio/client";
import { log } from "@/lib/logger";

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

        // Note: Deleting APPROVED drafts is allowed since the imported questions
        // are separate records in the Question table. The draft and questions
        // are independent objects - deleting the draft does not affect them.

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
                log.warn('parser', 'Failed to delete raw file from MinIO', { url: draft.originalUrl, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // Extracted inline images from JSON
        const draftData = draft.draftJson as Record<string, unknown>;
        if (draftData && Array.isArray((draftData as { questions?: unknown[] }).questions)) {
            for (const q of (draftData as { questions: Array<{ imagePlaceholders?: string[] }> }).questions) {
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
                            log.warn('parser', 'Failed to delete asset image from MinIO', { url: imgUrl, error: e instanceof Error ? e.message : String(e) });
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

    } catch (error: unknown) {
        log.error('parser', 'Draft deletion failed', { error: error instanceof Error ? error.message : String(error) });
        return Res.internal("刪除草稿時發生伺服器錯誤");
    }
}
