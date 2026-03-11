/**
 * workers/parser.worker.ts
 * BullMQ Worker — Document Parsing Pipeline
 *
 * Pipeline per job:
 *   1. Download raw file from MinIO as a Readable stream
 *   2. Route to Word or PDF branch:
 *      Word: mammoth → HTML → Markdown, images stream → MinIO assets bucket
 *      PDF : child_process.spawn(pdftoppm) → PNG files in /tmp → MinIO assets bucket
 *   3. Build page image list → AI extraction (OpenAI / Gemini) → Zod validation
 *   4. Write ParsedDraft record (AWAITING_REVIEW) to PostgreSQL
 *   5. Cleanup /tmp/parser-{jobId}/ in finally block (always)
 *
 * Resilience:
 *   - PDF subprocess timeout: 60 s hard limit + SIGKILL fallback
 *   - BullMQ lockDuration: 660 s to cover cockatiel's 600 s timeout + retry delays
 *   - All uploads streaming (zero-copy) via MinIO SDK
 *   - ParsedDraft.errorLog captures failure details for admin review
 */

import { Worker, type Job, Queue } from "bullmq";
import { log, setLogSink } from "../lib/logger";
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
import {
    extractQuestionsFromImages,
    waitForServiceHealth,
    type ExtractionResponse,
    type LLMMeta,
    type ImageDataPart,
} from "../lib/ai";
import type { ChildProcess } from "node:child_process";

// TUI store — ink components consume this reactively
import {
    upsertJob,
    removeJob,
    setQueueCounts,
    appendLog,
    setWorkerMeta,
} from "./tui/store.js";

const _execAsync = promisify(exec);

// Track all spawns so we can SIGKILL them if graceful shutdown times out.
const activeSubprocesses = new Set<ChildProcess>();

// ---------------------------------------------------------------------------
// Concurrency & lock configuration
// ---------------------------------------------------------------------------
const WORKER_CONCURRENCY = 3;
const LOCK_DURATION_MS = 660_000; // 660 s — must exceed cockatiel's 600 s timeout + retry delays

// ---------------------------------------------------------------------------
// AI batch configuration — split images into smaller groups to avoid
// overwhelming the AI service with huge payloads.
// ---------------------------------------------------------------------------
const AI_BATCH_SIZE = Number(process.env.AI_BATCH_SIZE) || 3;

// ---------------------------------------------------------------------------
// Progress reporter — writes to BullMQ (for frontend) AND TUI store (for operator)
// ---------------------------------------------------------------------------

/**
 * Single source of truth for progress — writes to BOTH BullMQ and the TUI store.
 * Frontend polls BullMQ; operator reads the ink TUI. Data is always identical.
 */
async function reportProgress(
    job: Job<ParseDocumentJobData>,
    percent: number,
    message: string,
): Promise<void> {
    // 1. Write to BullMQ (frontend reads this via status API)
    await job.updateProgress({ percent, message });

    // 2. Update TUI store (ink renders the progress bar)
    upsertJob(job.id!, { percent, message });
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------
async function processParseJob(job: Job<ParseDocumentJobData>): Promise<void> {
    const { traceId, docType, s3Key, originalFilename } = job.data;
    const tmpDir = path.join(tmpdir(), `parser-${traceId}`);

    // Register this job in the TUI store so the progress table shows it
    upsertJob(job.id!, {
        filename: originalFilename ?? s3Key,
        percent: 0,
        message: "Starting...",
    });

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

        // --- Split images into batches to avoid overwhelming the AI service ---
        const batches: ImageDataPart[][] = [];
        for (let i = 0; i < imageDataParts.length; i += AI_BATCH_SIZE) {
            batches.push(imageDataParts.slice(i, i + AI_BATCH_SIZE));
        }
        const totalBatches = batches.length;

        log.info('parser-worker', `Splitting ${imageDataParts.length} images into ${totalBatches} batches of ≤${AI_BATCH_SIZE}`, {
            traceId,
            totalImages: imageDataParts.length,
            batchSize: AI_BATCH_SIZE,
            totalBatches,
        });

        // --- Process each batch sequentially ---
        const batchResults: { data: ExtractionResponse; meta: LLMMeta }[] = [];

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const batch = batches[batchIdx];
            const batchLabel = `批次 ${batchIdx + 1}/${totalBatches}`;

            // Health check before each batch (including the first)
            await reportProgress(job, 65, `${batchLabel}：正在等待 AI 服務就緒...`);
            const waitResult = await waitForServiceHealth({
                maxWaitMs: 180_000,
                pollIntervalMs: 5_000,
                onAttempt: (attempt, health) => {
                    const msg = health.healthy
                        ? `AI 服務已就緒 (嘗試 ${attempt} 次)`
                        : `${batchLabel}：等待 AI 服務... (嘗試 ${attempt} 次)`;
                    log.info('parser-worker', msg, {
                        traceId,
                        attempt,
                        batchIndex: batchIdx,
                        latencyMs: health.latencyMs,
                    });
                },
            });

            if (!waitResult.ready) {
                throw new Error(
                    `AI 服務在 ${waitResult.attempts} 次嘗試後仍未就緒: ${waitResult.finalHealth.error}`
                );
            }

            // Progress: scale 65–85 across all batches
            const batchProgressBase = 65 + Math.round((batchIdx / totalBatches) * 20);
            await reportProgress(
                job,
                batchProgressBase,
                `${batchLabel}：AI 服務就緒 (延遲 ${waitResult.finalHealth.latencyMs}ms)，正在萃取題目 (${batch.length} 張圖片)...`
            );

            // AI extraction for this batch
            const batchResult = await extractQuestionsFromImages(
                batch,
                `${traceId}__batch${batchIdx + 1}`,
                (msg) => {
                    reportProgress(job, batchProgressBase, `${batchLabel}：${msg}`).catch(() => {});
                }
            );

            batchResults.push(batchResult);

            log.info('parser-worker', `${batchLabel} completed: ${batchResult.data.questions.length} questions extracted`, {
                traceId,
                batchIndex: batchIdx,
                questionsInBatch: batchResult.data.questions.length,
                elapsedMs: batchResult.meta.elapsedMs,
            });
        }

        // --- Merge batch results ---
        const mergedQuestions = batchResults.flatMap((r) => r.data.questions);
        const extraction: ExtractionResponse = {
            questions: mergedQuestions,
            metadata: {
                year: batchResults[0]?.data.metadata.year,
                examType: batchResults[0]?.data.metadata.examType,
                pageCount: imageDataParts.length,
            },
        };

        const llmMeta: LLMMeta = {
            provider: batchResults[0]?.meta.provider ?? "openai",
            model: batchResults[0]?.meta.model ?? "unknown",
            imageCount: imageDataParts.length,
            totalPayloadMB: batchResults.reduce((sum, r) => sum + Number(r.meta.totalPayloadMB), 0).toFixed(2),
            totalAttempts: batchResults.reduce((sum, r) => sum + r.meta.totalAttempts, 0),
            elapsedMs: batchResults.reduce((sum, r) => sum + r.meta.elapsedMs, 0),
            responseLength: batchResults.reduce((sum, r) => sum + r.meta.responseLength, 0),
            finishReason: batchResults.map((r) => r.meta.finishReason).join(","),
            promptTokenCount: batchResults.reduce((sum, r) => sum + r.meta.promptTokenCount, 0),
            candidatesTokenCount: batchResults.reduce((sum, r) => sum + r.meta.candidatesTokenCount, 0),
            questionCount: mergedQuestions.length,
            timestamp: new Date().toISOString(),
        };

        await reportProgress(job, 90, `AI 萃取完成：${extraction.questions.length} 道題目，正在寫入資料庫`);

        // --- Persist draft + AI metadata (AWAITING_REVIEW) ---
        await db.parsedDraft.upsert({
            where: { jobId: job.id! },
            update: {
                draftJson: extraction as object,
                status: "AWAITING_REVIEW",
                geminiMeta: llmMeta as object,
            },
            create: {
                jobId: job.id!,
                originalUrl: s3Key,
                draftJson: extraction as object,
                status: "AWAITING_REVIEW",
                geminiMeta: llmMeta as object,
            },
        });

        await reportProgress(job, 100, '✅ 全部完成，等待人工審核');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;

        // Log failure — TUI will display this via the log panel
        log.error('parser-worker', `Job failed: ${message}`, {
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
        // Remove job from TUI active jobs table
        removeJob(job.id!);

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
    await reportProgress(job, 20, 'Word 檔案下載完成，正在解析圖片...');

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

    await reportProgress(job, 40, `Word 圖片擷取完成 (${imageParts.length} 張)`);

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
    const { readFile } = await import('node:fs/promises');
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

        const buffer = await readFile(localPath);
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
// PDF rasterization with parallel multi-process execution
// ---------------------------------------------------------------------------

const execAsync = promisify(exec);

/** Configurable render DPI via env var (default 300) */
const PDF_RENDER_DPI = parseInt(process.env.PDF_RENDER_DPI || '300', 10);

/** Number of parallel pdftoppm processes (default: 4, capped at 8) */
const PDF_PARALLEL_WORKERS = Math.min(
    parseInt(process.env.PDF_PARALLEL_WORKERS || '4', 10),
    8
);

/**
 * Get the page count of a PDF using pdfinfo (part of Poppler).
 */
async function getPdfPageCount(inputPath: string): Promise<number> {
    try {
        const { stdout } = await execAsync(`pdfinfo "${inputPath}"`, { timeout: 30_000 });
        const match = stdout.match(/Pages:\s+(\d+)/);
        if (!match) throw new Error('Could not parse page count from pdfinfo');
        return parseInt(match[1], 10);
    } catch (err) {
        log.warn('parser-worker', 'pdfinfo failed, falling back to single-process mode', {
            error: err instanceof Error ? err.message : String(err),
        });
        return -1; // Sentinel: unknown page count → fallback to single process
    }
}

/**
 * Spawn a single pdftoppm child for a page range [firstPage, lastPage].
 */
function rasterizePageRange(
    inputPath: string,
    outputPrefix: string,
    firstPage: number,
    lastPage: number,
    traceId: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "pdftoppm",
            [
                "-png",
                "-r", String(PDF_RENDER_DPI),
                "-f", String(firstPage),
                "-l", String(lastPage),
                inputPath,
                outputPrefix,
            ],
            {
                timeout: 300_000,
                killSignal: "SIGKILL",
            }
        );

        activeSubprocesses.add(child);

        let stderrBuffer = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            stderrBuffer += chunk.toString();
            if (stderrBuffer.length > 50_000) {
                stderrBuffer = stderrBuffer.slice(-50_000);
            }
        });

        child.on("close", (code, signal) => {
            activeSubprocesses.delete(child);
            if (signal) {
                reject(
                    new Error(
                        `pdftoppm killed by signal ${signal} (pages ${firstPage}-${lastPage}) [traceId=${traceId}]`
                    )
                );
            } else if (code !== 0) {
                reject(
                    new Error(
                        `pdftoppm exited with code ${code} (pages ${firstPage}-${lastPage}) [traceId=${traceId}]\nstderr: ${stderrBuffer.slice(0, 500)}`
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
                    `Failed to spawn pdftoppm (pages ${firstPage}-${lastPage}) [traceId=${traceId}]: ${err.message}`
                )
            );
        });
    });
}

/**
 * Rasterize a PDF to PNGs using parallel pdftoppm processes.
 *
 * Strategy:
 *  1. Use `pdfinfo` to get page count
 *  2. Split pages into N chunks (N = CPU count, capped at 8)
 *  3. Spawn N parallel pdftoppm processes with -f/-l flags
 *  4. Promise.all to await all processes
 *
 * Falls back to single-process mode if pdfinfo fails or for small PDFs.
 */
async function rasterizePdf(
    inputPath: string,
    outputPrefix: string,
    traceId: string
): Promise<void> {
    const pageCount = await getPdfPageCount(inputPath);

    // For small PDFs or if pdfinfo failed, use single process
    const numWorkers = Math.min(
        pageCount <= 0 ? 1 : Math.max(1, Math.min(pageCount, PDF_PARALLEL_WORKERS)),
        8
    );

    if (numWorkers <= 1 || pageCount <= 0) {
        // Single-process fallback (original behavior)
        return rasterizePageRange(inputPath, outputPrefix, 1, pageCount > 0 ? pageCount : 999999, traceId);
    }

    log.info('parser-worker', `Parallel PDF rasterization: ${pageCount} pages across ${numWorkers} processes at ${PDF_RENDER_DPI} DPI`, {
        traceId,
        pageCount,
        workers: numWorkers,
        dpi: PDF_RENDER_DPI,
    });

    // Split pages into roughly equal chunks
    const pagesPerWorker = Math.ceil(pageCount / numWorkers);
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < numWorkers; i++) {
        const firstPage = i * pagesPerWorker + 1;
        const lastPage = Math.min((i + 1) * pagesPerWorker, pageCount);
        if (firstPage > pageCount) break;

        tasks.push(rasterizePageRange(inputPath, outputPrefix, firstPage, lastPage, traceId));
    }

    await Promise.all(tasks);
}

// ---------------------------------------------------------------------------
// Worker bootstrap + TUI initialisation
// ---------------------------------------------------------------------------

// 1. Wire logger → TUI store (must happen before any log.* calls below)
setLogSink(({ level, service, message, timestamp, meta }) => {
    appendLog({ level, service, message, timestamp, meta });
});

// 2. Create the BullMQ worker
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

// 3. Populate TUI metadata
const provider = process.env.LLM_PROVIDER ?? "openai";
setWorkerMeta({ concurrency: WORKER_CONCURRENCY, provider });

// 4. Worker lifecycle events → TUI store + logger
worker.on("completed", (job) => {
    removeJob(job.id!);
    log.info('parser-worker', 'Job completed', {
        event: "job_completed",
        jobId: job.id,
        traceId: job.data.traceId,
    });
});

worker.on("failed", (job, err) => {
    if (job?.id) removeJob(job.id);
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

// 5. Poll queue counts every 5 s for the TUI stats panel
const parserQueue = new Queue(QUEUE_NAMES.PARSER, { connection: redisConnection });
const QUEUE_POLL_INTERVAL_MS = 5_000;

async function pollQueueCounts(): Promise<void> {
    try {
        const counts = await parserQueue.getJobCounts(
            "waiting", "active", "completed", "failed", "delayed"
        );
        setQueueCounts({
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
        });
    } catch {
        // Silently ignore — Redis may be momentarily unreachable
    }
}

const queuePollTimer = setInterval(pollQueueCounts, QUEUE_POLL_INTERVAL_MS);
// Fire immediately so the TUI has data on first render
void pollQueueCounts();

// 6. Start ink TUI render
async function startTui(): Promise<void> {
    const React = await import("react");
    const { render } = await import("ink");
    const { default: App } = await import("./tui/App.js");

    render(React.createElement(App));
}

void startTui();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;

async function gracefulShutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info('parser-worker', `[${signal}] Initiating graceful shutdown... pausing worker.`);

    // 1. Stop queue polling
    clearInterval(queuePollTimer);

    // 2. Pause worker to stop picking up new jobs
    await worker.pause(true);

    const GRACEFUL_TIMEOUT_MS = 30_000;

    // 3. Start a hard kill timer
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
        // 4. Wait for currently executing jobs to finish natively
        await worker.close();

        // 5. Close the queue polling connection
        await parserQueue.close();

        // 6. Safely disconnect Prisma
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
