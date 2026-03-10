/**
 * POST /api/upload/presign
 *
 * Generates a short-lived Presigned URL for client-side direct uploads to MinIO.
 * 
 * Security:
 *  - Protected by Edge Middleware (JWT + CSRF).
 *  - Must specify role: USER, MODERATOR, ADMIN.
 *  - Uploads go to BUCKETS.RAW initially to be processed if needed, or ASSETS.
 *    For questions, we will dump directly to ASSETS but use a UUID key.
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import { PresignUploadSchema } from "@/lib/schemas";
import { presignedPutUrl, BUCKETS } from "@/lib/minio/client";
import * as crypto from "node:crypto";
import path from "node:path";
import { log } from "@/lib/logger";

export async function POST(request: NextRequest): Promise<Response> {
    const userId = request.headers.get("x-user-id");
    if (!userId) {
        return Res.unauthorized("未授權的要求");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = PresignUploadSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { filename } = parsed.data;

    // Generate a safe unique key: date/userId/UUID.ext
    const ext = path.extname(filename) || ".jpeg";
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const uuid = crypto.randomUUID();
    const objectKey = `uploads/${dateStr}/${userId}/${uuid}${ext}`;

    try {
        const url = await presignedPutUrl(BUCKETS.ASSETS, objectKey, 300); // 5 minutes

        return Res.ok({
            uploadUrl: url,
            objectKey,
            bucket: BUCKETS.ASSETS,
        });
    } catch (err: unknown) {
        log.error('upload', 'Presign URL generation failed', { error: err instanceof Error ? err.message : String(err) });
        return Res.internal("產生上傳連結失敗");
    }
}
