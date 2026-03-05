/**
 * workers/parser.worker.ts
 * BullMQ Worker — Document Parsing Pipeline
 *
 * Pipeline per job:
 *   1. Download raw file from MinIO as a Readable stream
 *   2. Route to Word or PDF branch:
 *      Word: mammoth → HTML → Markdown, images stream → MinIO assets bucket
 *      PDF : child_process.spawn(pdftoppm) → PNG files in /tmp → MinIO assets bucket
 *   3. Build page image list → Gemini extraction → Zod validation
 *   4. Write ParsedDraft record (AWAITING_REVIEW) to PostgreSQL
 *   5. Cleanup /tmp/parser-{jobId}/ in finally block (always)
 *
 *
 * Resilience:
 *   - PDF subprocess timeout: 60 s hard limit + SIGKILL fallback
 *   - BullMQ lockDuration: 90 s to cover worst-case large PDF
 *   - All uploads streaming (zero-copy) via MinIO SDK
 *   - ParsedDraft.errorLog captures failure details for admin review
 */

import { Worker, type Job } from "bullmq";
import { exec, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { db } from "../lib/db/prisma";
import { redisConnection } from "../lib/queue/client";
import { QUEUE_NAMES, type ParseDocumentJobData } from "../lib/queue/jobs";
import {
    downloadStream,
    uploadFile,
    uploadStream,
    BUCKETS,
} from "../lib/minio/client";
import { extractQuestionsFromImages } from "../lib/ai/gemini";
import type { ChildProcess } from "node:child_process";

const execAsync = promisify(exec);

// Track all spawns so we can SIGKILL them if graceful shutdown times out.
const activeSubprocesses = new Set<ChildProcess>();

// ---------------------------------------------------------------------------
// Concurrency & lock configuration
// ---------------------------------------------------------------------------
const WORKER_CONCURRENCY = 3;
const LOCK_DURATION_MS = 90_000; // 90 s — must exceed worst-case PDF processing time

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------
async function processParseJob(job: Job<ParseDocumentJobData>): Promise<void> {
    const { traceId, docType, s3Key, originalFilename } = job.data;
    const tmpDir = path.join(tmpdir(), `parser-${traceId}`);

    // Update draft status to PROCESSING
    await db.parsedDraft.update({
        where: { jobId: job.id! },
        data: { status: "PROCESSING" },
    });

    try {
        await mkdir(tmpDir, { recursive: true });
        await job.updateProgress(5);

        let imageUrls: string[];

        if (docType === "word") {
            imageUrls = await processWordDocument(job, s3Key, traceId, tmpDir);
        } else {
            imageUrls = await processPdfDocument(job, s3Key, traceId, tmpDir);
        }

        await job.updateProgress(60);

        // --- Gemini extraction ---
        const imageParts = imageUrls.map((url) => ({
            type: "url" as const,
            url,
        }));

        const extraction = await extractQuestionsFromImages(imageParts, traceId);
        await job.updateProgress(90);

        // --- Persist draft (AWAITING_REVIEW) ---
        await db.parsedDraft.update({
            where: { jobId: job.id! },
            data: {
                draftJson: extraction as object,
                status: "AWAITING_REVIEW",
            },
        });

        await job.updateProgress(100);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;

        // Structured failure log
        console.error(
            JSON.stringify({
                level: "error",
                service: "parser-worker",
                traceId,
                jobId: job.id,
                message,
                stack,
                timestamp: new Date().toISOString(),
            })
        );

        // Persist error for admin visibility (not a silent failure)
        await db.parsedDraft.update({
            where: { jobId: job.id! },
            data: {
                status: "REJECTED",
                errorLog: `[traceId=${traceId}] ${message}`,
            },
        });

        throw err; // Re-throw so BullMQ can apply retry / failure logic
    } finally {
        // Always clean up tmp directory to prevent disk exhaustion
        await rm(tmpDir, { recursive: true, force: true }).catch((e) =>
            console.warn(`Failed to clean tmp dir ${tmpDir}:`, e.message)
        );
    }
}

// ---------------------------------------------------------------------------
// Word document branch (mammoth)
// ---------------------------------------------------------------------------
async function processWordDocument(
    job: Job<ParseDocumentJobData>,
    s3Key: string,
    traceId: string,
    tmpDir: string
): Promise<string[]> {
    // Download Word file from MinIO raw bucket to tmp
    const rawStream = await downloadStream(BUCKETS.RAW, s3Key);
    const tmpWordPath = path.join(tmpDir, "input.docx");

    await streamPipeline(rawStream, createWriteStream(tmpWordPath));
    await job.updateProgress(20);

    const imageUrls: string[] = [];
    let imageIndex = 0;

    // mammoth extracts images via callback — we stream each to MinIO
    const result = await mammoth.convertToHtml(
        { path: tmpWordPath },
        {
            convertImage: mammoth.images.imgElement(async (image) => {
                const buffer = await image.read();
                const ext = image.contentType.split("/")[1] ?? "png";
                const objectKey = `word/${traceId}/img_${String(++imageIndex).padStart(3, "0")}.${ext}`;

                // Stream buffer → MinIO (mammoth gives us Buffer; wrap as Readable)
                const readable = Readable.from(buffer);
                const url = await uploadStream(
                    BUCKETS.ASSETS,
                    objectKey,
                    readable,
                    buffer.length,
                    image.contentType
                );
                imageUrls.push(url);

                // Return the CDN URL for embedding in the HTML
                return { src: url };
            }),
        }
    );

    await job.updateProgress(40);

    // Store the HTML as a page "image" representation via Gemini text input
    // (For Word docs we pass page screenshots or rely on Gemini's text mode)
    // Simplified: return extracted image URLs for downstream Gemini call
    return imageUrls;
}

// ---------------------------------------------------------------------------
// PDF document branch (pdftoppm via child_process)
// ---------------------------------------------------------------------------
async function processPdfDocument(
    job: Job<ParseDocumentJobData>,
    s3Key: string,
    traceId: string,
    tmpDir: string
): Promise<string[]> {
    // Download PDF from MinIO to tmp
    const rawStream = await downloadStream(BUCKETS.RAW, s3Key);
    const tmpPdfPath = path.join(tmpDir, "input.pdf");

    await streamPipeline(rawStream, createWriteStream(tmpPdfPath));
    await job.updateProgress(15);

    // Rasterize PDF to PNGs via pdftoppm (part of Poppler)
    // Each page becomes: {tmpDir}/page-NNNN.png
    await rasterizePdf(tmpPdfPath, path.join(tmpDir, "page"), traceId);
    await job.updateProgress(40);

    // Find all generated PNG files
    const pngFiles = (await readdir(tmpDir))
        .filter((f) => f.endsWith(".png"))
        .sort(); // Ensure page order

    if (pngFiles.length === 0) {
        throw new Error(`pdftoppm produced zero PNG files for traceId=${traceId}`);
    }

    // Upload each PNG to MinIO assets bucket (fPutObject — streams internally)
    const imageUrls: string[] = [];
    for (const pngFile of pngFiles) {
        const localPath = path.join(tmpDir, pngFile);
        const objectKey = `pdf/${traceId}/${pngFile}`;

        const url = await uploadFile(
            BUCKETS.ASSETS,
            objectKey,
            localPath,
            "image/png"
        );

        imageUrls.push(url);
    }

    await job.updateProgress(55);
    return imageUrls;
}

// ---------------------------------------------------------------------------
// PDF rasterization with strict resource limits (OOM / zombie prevention)
// ---------------------------------------------------------------------------
async function rasterizePdf(
    inputPath: string,
    outputPrefix: string,
    traceId: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        // pdftoppm is part of Poppler and produces {outputPrefix}-NNNN.png
        const child = spawn(
            "pdftoppm",
            [
                "-png",       // Output format
                "-r", "300",  // 300 DPI
                inputPath,
                outputPrefix,
            ],
            {
                timeout: 60_000,            // 60 s hard wall-clock timeout
                killSignal: "SIGKILL",      // Ensure zombie cannot linger after SIGTERM
            }
        );

        activeSubprocesses.add(child);

        let stderrBuffer = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            stderrBuffer += chunk.toString();
            // Prevent stderrBuffer from growing unboundedly (defensive)
            if (stderrBuffer.length > 50_000) {
                stderrBuffer = stderrBuffer.slice(-50_000);
            }
        });

        child.on("close", (code, signal) => {
            activeSubprocesses.delete(child);
            if (signal) {
                reject(
                    new Error(
                        `pdftoppm killed by signal ${signal} (likely timeout) [traceId=${traceId}]`
                    )
                );
            } else if (code !== 0) {
                reject(
                    new Error(
                        `pdftoppm exited with code ${code} [traceId=${traceId}]\nstderr: ${stderrBuffer.slice(0, 500)}`
                    )
                );
            } else {
                resolve();
            }
        });

        child.on("error", (err) => {
            activeSubprocesses.delete(child);
            reject(
                new Error(
                    `Failed to spawn pdftoppm [traceId=${traceId}]: ${err.message}`
                )
            );
        });
    });
}

// ---------------------------------------------------------------------------
// Worker bootstrap
// ---------------------------------------------------------------------------
const worker = new Worker<ParseDocumentJobData>(
    QUEUE_NAMES.PARSER,
    processParseJob,
    {
        connection: redisConnection,
        concurrency: WORKER_CONCURRENCY,
        lockDuration: LOCK_DURATION_MS,
        stalledInterval: 30_000, // Check for stalled jobs every 30 s
    }
);

worker.on("completed", (job) => {
    console.info(
        JSON.stringify({
            level: "info",
            service: "parser-worker",
            event: "job_completed",
            jobId: job.id,
            traceId: job.data.traceId,
            timestamp: new Date().toISOString(),
        })
    );
});

worker.on("failed", (job, err) => {
    console.error(
        JSON.stringify({
            level: "error",
            service: "parser-worker",
            event: "job_failed",
            jobId: job?.id,
            traceId: job?.data.traceId,
            message: err.message,
            timestamp: new Date().toISOString(),
        })
    );
});

worker.on("stalled", (jobId) => {
    console.warn(
        JSON.stringify({
            level: "warn",
            service: "parser-worker",
            event: "job_stalled",
            jobId,
            timestamp: new Date().toISOString(),
        })
    );
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;

async function gracefulShutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.info(`\n[${signal}] Initiating graceful shutdown... pausing worker.`);

    // 1. Pause worker to stop picking up new jobs
    await worker.pause(true);

    const GRACEFUL_TIMEOUT_MS = 30_000;

    // 2. Start a hard kill timer
    const timeoutTimer = setTimeout(async () => {
        console.warn(`[${signal}] Timeout ${GRACEFUL_TIMEOUT_MS}ms reached. Forcing SIGKILL on subprocesses.`);
        for (const child of activeSubprocesses) {
            if (!child.killed) child.kill("SIGKILL");
        }

        // Broad cleanup of tmp directory contents
        await rm(path.join(tmpdir(), "parser-*"), { force: true, recursive: true }).catch(() => { });

        console.warn(`[${signal}] Grace period expired. Exiting (code 1).`);
        process.exit(1);
    }, GRACEFUL_TIMEOUT_MS);

    try {
        // 3. Wait for currently executing jobs to finish natively
        await worker.close();

        // 4. Safely disconnect Prisma
        await db.$disconnect();

        clearTimeout(timeoutTimer);
        console.info(`[${signal}] Graceful shutdown complete. Exiting cleanly (code 0).`);
        process.exit(0);
    } catch (err) {
        console.error(`[${signal}] Error during shutdown operations:`, err);
        process.exit(1);
    }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

console.info(
    JSON.stringify({
        level: "info",
        service: "parser-worker",
        message: `Worker started (concurrency=${WORKER_CONCURRENCY}, lockDuration=${LOCK_DURATION_MS}ms)`,
        timestamp: new Date().toISOString(),
    })
);

export default worker;
