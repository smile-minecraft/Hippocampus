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
 *   - BullMQ lockDuration: 300 s to cover worst-case large PDF
 *   - All uploads streaming (zero-copy) via MinIO SDK
 *   - ParsedDraft.errorLog captures failure details for admin review
 */

import { Worker, type Job } from "bullmq";
import { log } from "../lib/logger";
import { exec, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
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

const _execAsync = promisify(exec);

// Track all spawns so we can SIGKILL them if graceful shutdown times out.
const activeSubprocesses = new Set<ChildProcess>();

// ---------------------------------------------------------------------------
// Concurrency & lock configuration
// ---------------------------------------------------------------------------
const WORKER_CONCURRENCY = 3;
const LOCK_DURATION_MS = 300_000; // 300 s — must exceed worst-case Gemini timeout (600s) + retry delays

// ---------------------------------------------------------------------------
// Terminal progress bar renderer
// ---------------------------------------------------------------------------
const BAR_WIDTH = 30;
const COLORS = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    bgGreen: "\x1b[42m",
    bgWhite: "\x1b[47m",
};

/**
 * Single source of truth for progress — writes to BOTH terminal and BullMQ.
 * Frontend polls BullMQ; operator reads terminal. Data is always identical.
 */
async function reportProgress(
    job: Job<ParseDocumentJobData>,
    percent: number,
    message: string,
): Promise<void> {
    // 1. Write to BullMQ (frontend reads this via status API)
    await job.updateProgress({ percent, message });

    // 2. Render visual progress bar in terminal
    const filled = Math.round((percent / 100) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    const bar = `${COLORS.bgGreen}${" ".repeat(filled)}${COLORS.reset}${COLORS.dim}${"░".repeat(empty)}${COLORS.reset}`;
    const pctStr = `${String(percent).padStart(3)}%`;
    const jobShort = job.id?.slice(0, 8) ?? "????????";
    const timestamp = new Date().toLocaleTimeString("zh-TW", { hour12: false });

    // Use single-line overwrite for active jobs (carriage return)
    const line = `${COLORS.dim}${timestamp}${COLORS.reset} ${COLORS.cyan}[${jobShort}]${COLORS.reset} ${bar} ${COLORS.bold}${pctStr}${COLORS.reset} ${message}`;

    if (percent >= 100) {
        // Final state — print on a new line so it persists in scroll-back
        process.stdout.write(`\n${line}\n`);
    } else {
        // Overwrite the current line for a cleaner look
        process.stdout.write(`\r\x1b[K${line}`);
    }
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------
async function processParseJob(job: Job<ParseDocumentJobData>): Promise<void> {
    const { traceId, docType, s3Key, originalFilename } = job.data;
    const tmpDir = path.join(tmpdir(), `parser-${traceId}`);

    log.info('parser-worker', `Job started: ${traceId}`, { jobId: job.id, file: originalFilename ?? s3Key, docType });

    // Update draft status to PROCESSING
    // Using upsert for maximum resilience against race conditions or missing records.
    await db.parsedDraft.upsert({
        where: { jobId: job.id! },
        update: { status: "PROCESSING" },
        create: {
            jobId: job.id!,
            originalUrl: s3Key,
            draftJson: [],
            status: "PROCESSING",
        },
    });

    try {
        await mkdir(tmpDir, { recursive: true });
        await reportProgress(job, 5, '正在準備暫存目錄與檔案解碼...');

        let imageDataParts: Array<{ type: "base64"; mimeType: string; data: string }>;

        if (docType === "word") {
            imageDataParts = await processWordDocument(job, s3Key, traceId, tmpDir);
        } else {
            imageDataParts = await processPdfDocument(job, s3Key, traceId, tmpDir);
        }

        await reportProgress(job, 60, `圖片轉換完成 (${imageDataParts.length} 張)，正在送入 AI 模型`);

        // --- Gemini extraction with progress callback ---
        const { data: extraction, meta: geminiMeta } = await extractQuestionsFromImages(
            imageDataParts,
            traceId,
            (msg) => {
                // Fire-and-forget progress update during AI processing
                reportProgress(job, 70, msg).catch(() => { /* non-critical progress update */ });
            }
        );

        await reportProgress(job, 90, `AI 萃取完成：${extraction.questions.length} 道題目，正在寫入資料庫`);

        // --- Persist draft + AI metadata (AWAITING_REVIEW) ---
        await db.parsedDraft.upsert({
            where: { jobId: job.id! },
            update: {
                draftJson: extraction as object,
                status: "AWAITING_REVIEW",
                geminiMeta: geminiMeta as object,
            },
            create: {
                jobId: job.id!,
                originalUrl: s3Key,
                draftJson: extraction as object,
                status: "AWAITING_REVIEW",
                geminiMeta: geminiMeta as object,
            },
        });

        await reportProgress(job, 100, '✅ 全部完成，等待人工審核');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;

        // Terminal failure output
        process.stdout.write(`\r\x1b[K${COLORS.red}❌ [${job.id?.slice(0, 8)}] FAILED: ${message}${COLORS.reset}\n`);

        // Structured failure log
        log.error('parser-worker', message, {
            traceId,
            jobId: job.id,
            stack,
        });

        // Persist error for admin visibility (not a silent failure) — also use upsert
        await db.parsedDraft.upsert({
            where: { jobId: job.id! },
            update: {
                status: "REJECTED",
                errorLog: `[traceId=${traceId}] ${message}`,
            },
            create: {
                jobId: job.id!,
                originalUrl: s3Key,
                draftJson: [],
                status: "REJECTED",
                errorLog: `[traceId=${traceId}] ${message}`,
            },
        });

        throw err; // Re-throw so BullMQ can apply retry / failure logic
    } finally {
        // Always clean up tmp directory to prevent disk exhaustion
        await rm(tmpDir, { recursive: true, force: true }).catch((e) =>
            log.warn('parser-worker', `Failed to clean tmp dir ${tmpDir}`, { error: e.message })
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
): Promise<Array<{ type: "base64"; mimeType: string; data: string }>> {
    // Download Word file from MinIO raw bucket to tmp
    const rawStream = await downloadStream(BUCKETS.RAW, s3Key);
    const tmpWordPath = path.join(tmpDir, "input.docx");

    await streamPipeline(rawStream, createWriteStream(tmpWordPath));
    await job.updateProgress(20);

    const imageParts: Array<{ type: "base64"; mimeType: string; data: string }> = [];
    let imageIndex = 0;

    // mammoth extracts images via callback — we stream each to MinIO
    const _result = await mammoth.convertToHtml(
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

                imageParts.push({
                    type: "base64",
                    mimeType: image.contentType,
                    data: buffer.toString("base64"),
                });

                // Return the CDN URL for embedding in the HTML
                return { src: url };
            }),
        }
    );

    await job.updateProgress(40);

    // Store the HTML as a page "image" representation via Gemini text input
    // (For Word docs we pass page screenshots or rely on Gemini's text mode)
    // Simplified: return extracted image URLs for downstream Gemini call
    return imageParts;
}

// ---------------------------------------------------------------------------
// PDF document branch (pdftoppm via child_process)
// ---------------------------------------------------------------------------
async function processPdfDocument(
    job: Job<ParseDocumentJobData>,
    s3Key: string,
    traceId: string,
    tmpDir: string
): Promise<Array<{ type: "base64"; mimeType: string; data: string }>> {
    // Download PDF from MinIO to tmp
    const rawStream = await downloadStream(BUCKETS.RAW, s3Key);
    const tmpPdfPath = path.join(tmpDir, "input.pdf");

    await streamPipeline(rawStream, createWriteStream(tmpPdfPath));
    const startMsg = "正在提取高解析度圖片，大檔轉換可能費時數分鐘，請稍候...";
    log.info('parser-worker', startMsg, { percent: 15 });
    await job.updateProgress({ percent: 15, message: startMsg });

    // Rasterize PDF to PNGs via pdftoppm (part of Poppler)
    // Each page becomes: {tmpDir}/page-NNNN.png
    await rasterizePdf(tmpPdfPath, path.join(tmpDir, "page"), traceId);
    log.info('parser-worker', '圖片轉換成功！正在準備上傳至儲存庫...', { percent: 40 });
    await job.updateProgress({ percent: 40, message: "圖片轉換成功！正在準備上傳至儲存庫..." });

    // Find all generated PNG files
    const pngFiles = (await readdir(tmpDir))
        .filter((f) => f.endsWith(".png"))
        .sort(); // Ensure page order

    if (pngFiles.length === 0) {
        throw new Error(`pdftoppm produced zero PNG files for traceId=${traceId}`);
    }

    // Upload each PNG to MinIO assets bucket (fPutObject — streams internally)
    const { readFileSync } = await import('node:fs');
    const imageParts: Array<{ type: "base64"; mimeType: string; data: string }> = [];

    for (const pngFile of pngFiles) {
        const localPath = path.join(tmpDir, pngFile);
        const objectKey = `pdf/${traceId}/${pngFile}`;

        const _url = await uploadFile(
            BUCKETS.ASSETS,
            objectKey,
            localPath,
            "image/png"
        );

        const buffer = readFileSync(localPath);
        imageParts.push({
            type: "base64",
            mimeType: "image/png",
            data: buffer.toString("base64"),
        });
    }

    await job.updateProgress(55);
    return imageParts;
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
                timeout: 300_000,           // 300 s (5 mins) wall-clock timeout for large PDFs
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
    log.info('parser-worker', 'Job completed', {
        event: "job_completed",
        jobId: job.id,
        traceId: job.data.traceId,
    });
});

worker.on("failed", (job, err) => {
    log.error('parser-worker', 'Job failed', {
        event: "job_failed",
        jobId: job?.id,
        traceId: job?.data.traceId,
        message: err.message,
    });
});

worker.on("stalled", (jobId) => {
    log.warn('parser-worker', 'Job stalled', {
        event: "job_stalled",
        jobId,
    });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;

async function gracefulShutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info('parser-worker', `[${signal}] Initiating graceful shutdown... pausing worker.`);

    // 1. Pause worker to stop picking up new jobs
    await worker.pause(true);

    const GRACEFUL_TIMEOUT_MS = 30_000;

    // 2. Start a hard kill timer
    const timeoutTimer = setTimeout(async () => {
        log.warn('parser-worker', `[${signal}] Timeout ${GRACEFUL_TIMEOUT_MS}ms reached. Forcing SIGKILL on subprocesses.`);
        for (const child of activeSubprocesses) {
            if (!child.killed) child.kill("SIGKILL");
        }

        // Broad cleanup of tmp directory contents
        await rm(path.join(tmpdir(), "parser-*"), { force: true, recursive: true }).catch(() => { /* best-effort cleanup */ });

        log.warn('parser-worker', `[${signal}] Grace period expired. Exiting (code 1).`);
        process.exit(1);
    }, GRACEFUL_TIMEOUT_MS);

    try {
        // 3. Wait for currently executing jobs to finish natively
        await worker.close();

        // 4. Safely disconnect Prisma
        await db.$disconnect();

        clearTimeout(timeoutTimer);
        log.info('parser-worker', `[${signal}] Graceful shutdown complete. Exiting cleanly (code 0).`);
        process.exit(0);
    } catch (err) {
        log.error('parser-worker', `[${signal}] Error during shutdown operations`, { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
    }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

log.info('parser-worker', 'Worker started', {
    concurrency: WORKER_CONCURRENCY,
    lockDuration: LOCK_DURATION_MS,
});

export default worker;
