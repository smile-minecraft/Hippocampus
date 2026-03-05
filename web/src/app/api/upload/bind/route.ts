/**
 * POST /api/upload/bind
 *
 * Binds a freshly uploaded CDN URL to a Question's imageUrls array.
 * 
 * Security:
 *  - Protected by Edge Middleware (JWT + CSRF).
 *  - Guarded: Only MODERATOR or ADMIN can bind images to questions.
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import { BindUploadSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { BUCKETS } from "@/lib/minio/client";

function buildPublicUrl(bucket: string, objectKey: string): string {
    const baseUrl = process.env.MINIO_PUBLIC_URL ?? `http://localhost:9000/${bucket}`;
    return `${baseUrl}/${objectKey}`;
}

export async function POST(request: NextRequest): Promise<Response> {
    const role = request.headers.get("x-user-role");
    if (role !== "MODERATOR" && role !== "ADMIN") {
        return Res.forbidden("需要版主或管理員權限");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = BindUploadSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { questionId, fileKey } = parsed.data;

    // Verify question exists
    const question = await db.question.findFirst({
        where: { id: questionId, deletedAt: null },
        select: { id: true, imageUrls: true },
    });

    if (!question) {
        return Res.notFound("題目不存在");
    }

    const newImageUrl = buildPublicUrl(BUCKETS.ASSETS, fileKey);

    // Prevent duplicate binding
    if (question.imageUrls.includes(newImageUrl)) {
        return Res.ok({ message: "圖片已綁定", imageUrls: question.imageUrls });
    }

    try {
        const updated = await db.question.update({
            where: { id: questionId },
            data: {
                imageUrls: { push: newImageUrl }
            },
            select: { id: true, imageUrls: true },
        });

        return Res.ok(updated);
    } catch (err: unknown) {
        console.error("[POST /api/upload/bind] Error:", err);
        return Res.internal("綁定圖片失敗");
    }
}
