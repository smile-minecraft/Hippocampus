import { NextRequest, NextResponse } from "next/server";
import { uploadStream } from "@/lib/minio/client";
import { enqueueParseJob } from "@/lib/queue/jobs";
import { randomUUID } from "crypto";
import { ParserUploadSchema } from "@/lib/schemas";
import { ApiResponse, ParserJobResponsePayload } from "@/types";
import { db } from "@/lib/db/prisma";
import busboy from "busboy";
import { Readable } from "stream";
import { log } from "@/lib/logger";

// Override Vercel/Next timeout limit to 5 mins
export const maxDuration = 300;

export async function POST(
    req: NextRequest
): Promise<NextResponse<ApiResponse<ParserJobResponsePayload>>> {
    try {
        // 1. Authentication — use real user ID from middleware
        const userId = req.headers.get("x-user-id");
        if (!userId) {
            return NextResponse.json(
                { ok: false, code: "UNAUTHORIZED", message: "請先登入" },
                { status: 401 }
            );
        }

        // Convert incoming web ReadableStream to Node.js Readable
        const bb = busboy({ headers: { "content-type": req.headers.get("content-type") || "" } });

        let docType: string | null = null;
        let explicitFilename: string | null = null;
        let fileStream: NodeJS.ReadableStream | null = null;
        let originalFilename = "";
        let minioUploadPromise: Promise<string> | null = null;

        const traceId = randomUUID();

        // 3. Process the stream
        await new Promise<void>((resolve, reject) => {
            bb.on("field", (name, val) => {
                if (name === "docType") docType = val;
                if (name === "originalFilename") explicitFilename = val;
            });

            bb.on("file", (name, stream, info) => {
                if (name === "file") {
                    // Use the explicitly provided UTF-8 field if available, 
                    // otherwise fall back to busboy's filename header and attempt decoding
                    let safeFilename = explicitFilename || info.filename;

                    if (!explicitFilename && /[^\x00-\x7F]/.test(safeFilename)) {
                        try {
                            const restored = Buffer.from(safeFilename, 'latin1').toString('utf8');
                            if (!restored.includes('')) safeFilename = restored;
                        } catch { /* ignore encoding error */ }
                    }
                    originalFilename = safeFilename;
                    fileStream = stream;

                    if (!docType) {
                        // docType hasn't arrived yet, reject.
                        // Ideally fields should come before files in FormData.
                        // Or we buffer, but we don't want to buffer a 100MB file.
                        // For this app, `docType` is appended first.
                        reject(new Error("docType 必須在 file 之前上傳"));
                        return;
                    }

                    // Pipe directly to MinIO
                    const prefix = userId;
                    const extension = originalFilename.split(".").pop()?.toLowerCase() || "pdf";
                    const objectKey = `uploads/${prefix}/${traceId}.${extension}`;

                    minioUploadPromise = uploadStream(
                        process.env.MINIO_BUCKET_RAW || "hippocampus-raw",
                        objectKey,
                        stream as Readable, // cast to generic readable stream
                        -1 // Unknown size
                    );
                } else {
                    stream.resume(); // discard other files
                }
            });

            bb.on("close", () => {
                if (!fileStream) {
                    reject(new Error("未提供檔案"));
                } else {
                    resolve();
                }
            });

            bb.on("error", reject);

            const nodeStream = Readable.fromWeb(req.body as import("stream/web").ReadableStream);
            nodeStream.pipe(bb);
        });

        // Await the MinIO upload completion
        if (minioUploadPromise) {
            await minioUploadPromise;
        }

        // Validate docType
        const validation = ParserUploadSchema.safeParse({ docType });
        if (!validation.success) {
            return NextResponse.json(
                { ok: false, code: "VALIDATION_FAILED", message: validation.error.errors[0].message },
                { status: 400 }
            );
        }

        const extension = originalFilename.split(".").pop()?.toLowerCase() || "pdf";
        const objectKey = `uploads/${userId}/${traceId}.${extension}`;

        // 4. Create initial Draft record (idempotency support)
        // We must create this BEFORE enqueuing so the worker doesn't fail on Update
        await db.parsedDraft.create({
            data: {
                jobId: traceId,
                originalUrl: objectKey,
                originalFilename: originalFilename,
                draftJson: [],
                status: "PROCESSING",
            },
        });

        // 5. Enqueue Job to BullMQ
        const jobResult = await enqueueParseJob({
            traceId,
            uploadedBy: userId,
            docType: validation.data?.docType || "pdf",
            s3Key: objectKey,
            originalFilename: originalFilename,
            fileSizeBytes: 0, // Using busboy we stream without knowing size until end, could get from Minio later
        });

        // 6. Respond with Job ID for client-side polling
        return NextResponse.json({
            ok: true,
            data: { jobId: jobResult.jobId },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('parser', 'Upload failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            {
                ok: false,
                code: "INTERNAL_ERROR",
                message: `檔案上傳與解析任務建立失敗: ${message}`,
            },
            { status: 500 }
        );
    }
}
