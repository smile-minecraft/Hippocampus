/**
 * lib/minio/client.ts
 * MinIO SDK singleton with streaming-first upload helpers and retry logic.
 *
 * Design principles:
 * - All uploads use streams (never Buffer.from(await file.arrayBuffer()))
 * - Retry via exponential backoff (max 5 attempts, max delay 30s)
 * - Explicit bucket management helpers for bootstrap
 */

import { Client as MinioClient } from "minio";
import { Readable } from "node:stream";
import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
const globalForMinio = globalThis as unknown as {
    minioClient: MinioClient | undefined;
};

function createMinioClient(): MinioClient {
    const endpoint = process.env.MINIO_ENDPOINT ?? "localhost";
    const port = parseInt(process.env.MINIO_PORT ?? "9000", 10);
    const useSSL = process.env.MINIO_USE_SSL === "true";

    return new MinioClient({
        endPoint: endpoint,
        port,
        useSSL,
        accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
        secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
    });
}

export const minioClient: MinioClient =
    globalForMinio.minioClient ?? createMinioClient();

if (process.env.NODE_ENV !== "production") {
    globalForMinio.minioClient = minioClient;
}

// ---------------------------------------------------------------------------
// Bucket constants
// ---------------------------------------------------------------------------
export const BUCKETS = {
    RAW: process.env.MINIO_BUCKET_RAW ?? "hippocampus-raw",
    ASSETS: process.env.MINIO_BUCKET_ASSETS ?? "hippocampus-assets",
} as const;

// ---------------------------------------------------------------------------
// Retry helper (exponential backoff, no external lib dependency here)
// ---------------------------------------------------------------------------
async function withExponentialRetry<T>(
    operation: () => Promise<T>,
    {
        maxAttempts = 5,
        baseDelayMs = 500,
        maxDelayMs = 30_000,
        label = "minio-op",
    }: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        label?: string;
    } = {}
): Promise<T> {
    let attempt = 0;
    while (true) {
        attempt++;
        try {
            return await operation();
        } catch (err) {
            if (attempt >= maxAttempts) {
                log.error('minio', (err as Error).message, { label, attempt });
                throw err;
            }
            const jitter = Math.random() * 200;
            const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs);
            log.warn('minio', 'Retrying', { label, attempt, retryInMs: delay });
            await new Promise((res) => setTimeout(res, delay));
        }
    }
}

// ---------------------------------------------------------------------------
// Upload from Node.js Readable stream (zero-copy streaming upload)
// Use this when you have a Readable and know the content length.
// ---------------------------------------------------------------------------
export async function uploadStream(
    bucket: string,
    objectKey: string,
    stream: Readable,
    contentLength: number,
    contentType = "application/octet-stream"
): Promise<string> {
    await withExponentialRetry(
        () =>
            contentLength >= 0
                ? minioClient.putObject(bucket, objectKey, stream, contentLength, {
                    "Content-Type": contentType,
                })
                : (minioClient as unknown as { putObject: (bucket: string, key: string, stream: Readable, metadata: Record<string, string>) => Promise<unknown> }).putObject(bucket, objectKey, stream, {
                    "Content-Type": contentType,
                }),
        { label: `uploadStream:${objectKey}` }
    );

    const publicUrl = buildPublicUrl(bucket, objectKey);
    return publicUrl;
}

// ---------------------------------------------------------------------------
// Upload from a local file path (uses fPutObject — MinIO streams internally)
// Use this when contentLength is unknown (e.g. after pipe-to-tmp then upload).
// ---------------------------------------------------------------------------
export async function uploadFile(
    bucket: string,
    objectKey: string,
    filePath: string,
    contentType = "application/octet-stream"
): Promise<string> {
    await withExponentialRetry(
        () =>
            minioClient.fPutObject(bucket, objectKey, filePath, {
                "Content-Type": contentType,
            }),
        { label: `uploadFile:${objectKey}` }
    );

    return buildPublicUrl(bucket, objectKey);
}

// ---------------------------------------------------------------------------
// Delete Object
// ---------------------------------------------------------------------------
export async function deleteObject(
    bucket: string,
    objectKey: string
): Promise<void> {
    await withExponentialRetry(
        () => minioClient.removeObject(bucket, objectKey),
        { label: `deleteObject:${objectKey}` }
    );
}

// ---------------------------------------------------------------------------
// Download as Readable stream (zero-copy downstream)
// ---------------------------------------------------------------------------
export async function downloadStream(
    bucket: string,
    objectKey: string
): Promise<Readable> {
    return withExponentialRetry(
        () => minioClient.getObject(bucket, objectKey),
        { label: `downloadStream:${objectKey}` }
    );
}

// ---------------------------------------------------------------------------
// Generate a short-lived presigned URL (for client-side operations)
// ---------------------------------------------------------------------------
export async function presignedGetUrl(
    bucket: string,
    objectKey: string,
    expirySeconds = 3600
): Promise<string> {
    return minioClient.presignedGetObject(bucket, objectKey, expirySeconds);
}

// ---------------------------------------------------------------------------
// Generate a short-lived presigned URL for direct client-side uploads (PUT)
// ---------------------------------------------------------------------------
export async function presignedPutUrl(
    bucket: string,
    objectKey: string,
    expirySeconds = 300 // 5 minutes default for uploads
): Promise<string> {
    return minioClient.presignedPutObject(bucket, objectKey, expirySeconds);
}

// ---------------------------------------------------------------------------
// Build public CDN URL for assets bucket
// ---------------------------------------------------------------------------
function buildPublicUrl(bucket: string, objectKey: string): string {
    const baseUrl = process.env.MINIO_PUBLIC_URL ?? `http://localhost:9000/${bucket}`;
    return `${baseUrl}/${objectKey}`;
}

// ---------------------------------------------------------------------------
// Bootstrap: ensure required buckets exist (called on app startup)
// ---------------------------------------------------------------------------
export async function ensureBucketsExist(): Promise<void> {
    for (const bucket of Object.values(BUCKETS)) {
        const exists = await minioClient.bucketExists(bucket);
        if (!exists) {
            await minioClient.makeBucket(bucket, "us-east-1");
            log.info('minio', 'Bucket created', { bucket });
        }
    }
}

// Smoke test when run directly
if (require.main === module) {
    ensureBucketsExist()
        .then(() => log.info('minio', 'All buckets verified'))
        .catch((err) => {
            log.error('minio', 'Bucket bootstrap failed', { error: err instanceof Error ? err.message : String(err) });
            process.exit(1);
        });
}
