/**
 * workers/parser.worker.ts
 * BullMQ Worker — Document Parsing Pipeline
 *
 * Pipeline per job:
 *   1. Download raw file from MinIO as a Readable stream
 *   2. Route to Word or PDF branch:
 *      Word: mammoth → HTML → Markdown, images stream → MinIO assets bucket
 *      PDF : Direct upload to OpenAI Files API → GPT-5 Mini extraction
 *   3. AI extraction (OpenAI / Gemini) → Zod validation
 *   4. Write ParsedDraft record (AWAITING_REVIEW) to PostgreSQL
 *   5. Cleanup /tmp/parser-{jobId}/ in finally block (always)
 *
 * Resilience:
 *   - BullMQ lockDuration: 660 s to cover cockatiel's 600 s timeout + retry delays
 *   - All uploads streaming (zero-copy) via MinIO SDK
 *   - ParsedDraft.errorLog captures failure details for admin review
 */

import { Worker, type Job, Queue } from "bullmq";
import { log, setLogSink } from "../lib/logger";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { db } from "../lib/db/prisma";
import { redisConnection } from "../lib/queue/client";
import { QUEUE_NAMES, type ParseDocumentJobData } from "../lib/queue/jobs";
import {
    downloadStream,
    uploadStream,
    BUCKETS,
} from "../lib/minio/client";
import {
    extractQuestionsFromImages,
    extractQuestionsFromPdf,
    waitForServiceHealth,
    type ExtractionResponse,
    type LLMMeta,
    type ImageDataPart,
} from "../lib/ai";
import { splitPdfIntoChunks, getPdfPageCount } from "../lib/pdf-split";
import { readFile } from "node:fs/promises";

// TUI store — ink components consume this reactively
import {
    upsertJob,
    removeJob,
    setQueueCounts,
    appendLog,
    setWorkerMeta,
} from "./tui/store.js";

// Queue instance for cancellation checks (must be at module scope)
const parserQueue = new Queue(QUEUE_NAMES.PARSER, { connection: redisConnection });

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
// Cancellation helper — checks if job was requested to cancel
// ---------------------------------------------------------------------------
async function checkCancellation(job: Job<ParseDocumentJobData>, traceId: string): Promise<void> {
    if (job.data._cancelRequested) {
        log.info("parser-worker", `Job ${job.id} canceled by user`, { traceId, jobId: job.id });
        throw new Error("任務已被用戶取消");
    }
    const freshJob = await parserQueue.getJob(job.id!);
    if (freshJob?.data._cancelRequested) {
        job.data._cancelRequested = true;
        log.info("parser-worker", `Job ${job.id} canceled by user`, { traceId, jobId: job.id });
        throw new Error("任務已被用戶取消");
    }
}

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
    upsertJob(job.id!, "parser", { percent, message });
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------
async function processParseJob(job: Job<ParseDocumentJobData>): Promise<void> {
    const { traceId, docType, s3Key, originalFilename } = job.data;
    const tmpDir = path.join(tmpdir(), `parser-${traceId}`);

    // Register this job in the TUI store so the progress table shows it
    upsertJob(job.id!, "parser", {
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

        // --- Branch: Word (image-based extraction) or PDF (direct file upload) ---
        if (docType === "word") {
            const imageDataParts = await processWordDocument(job, s3Key, traceId, tmpDir);
            await reportProgress(job, 60, `圖片轉換完成 (${imageDataParts.length} 張)，正在送入 AI 模型`);

            // Process Word images in batches
            await processImageBatches(job, imageDataParts, traceId, tmpDir);
        } else {
            // PDF: Direct file upload to OpenAI Files API
            await processPdfDirect(job, s3Key, traceId, tmpDir);
        }
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
// Image batch processing (shared logic for Word documents)
// ---------------------------------------------------------------------------
async function processImageBatches(
    job: Job<ParseDocumentJobData>,
    imageDataParts: ImageDataPart[],
    traceId: string,
    tmpDir: string
): Promise<void> {
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
    let completedBatches = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        await checkCancellation(job, traceId);
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
        completedBatches++;

        // Report batch completion progress
        const batchProgressPercent = 65 + Math.round((completedBatches / totalBatches) * 20);
        await reportProgress(job, batchProgressPercent, `已完成 ${completedBatches}/${totalBatches} 批次，本批次萃取 ${batchResult.data.questions.length} 道題目`);

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

    await saveExtractionResult(job, extraction, llmMeta);
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
// PDF document branch — Direct upload to OpenAI Files API
// ---------------------------------------------------------------------------
const PDF_CHUNK_SIZE = Number(process.env.PDF_CHUNK_SIZE) || 3;

async function processPdfDirect(
    job: Job<ParseDocumentJobData>,
    s3Key: string,
    traceId: string,
    tmpDir: string
): Promise<void> {
    const rawStream = await downloadStream(BUCKETS.RAW, s3Key);
    const tmpPdfPath = path.join(tmpDir, "input.pdf");

    await streamPipeline(rawStream, createWriteStream(tmpPdfPath));
    await reportProgress(job, 20, 'PDF 檔案下載完成，正在分析頁數...');

    const pdfBuffer = await readFile(tmpPdfPath);
    const totalPages = await getPdfPageCount(pdfBuffer);

    log.info('parser-worker', `PDF has ${totalPages} pages`, { traceId, totalPages });

    await reportProgress(job, 25, '正在等待 AI 服務就緒...');
    await checkCancellation(job, traceId);
    const waitResult = await waitForServiceHealth({
        maxWaitMs: 180_000,
        pollIntervalMs: 5_000,
        onAttempt: (attempt, health) => {
            const msg = health.healthy
                ? `AI 服務已就緒 (嘗試 ${attempt} 次)`
                : `等待 AI 服務... (嘗試 ${attempt} 次)`;
            log.info('parser-worker', msg, {
                traceId,
                attempt,
                latencyMs: health.latencyMs,
            });
        },
    });

    if (!waitResult.ready) {
        throw new Error(
            `AI 服務在 ${waitResult.attempts} 次嘗試後仍未就緒: ${waitResult.finalHealth.error}`
        );
    }

    await reportProgress(job, 30, `AI 服務就緒 (延遲 ${waitResult.finalHealth.latencyMs}ms)`);

    if (totalPages <= PDF_CHUNK_SIZE) {
        await reportProgress(job, 35, `PDF 共 ${totalPages} 頁，無需分割，正在上傳...`);
        const result = await extractQuestionsFromPdf(
            tmpPdfPath,
            traceId,
            (msg) => { reportProgress(job, 50, msg).catch(() => {}); }
        );
        await reportProgress(job, 85, `PDF 萃取完成：${result.data.questions.length} 道題目，正在寫入資料庫`);
        await saveExtractionResult(job, result.data, result.meta);
        return;
    }

    const totalChunks = Math.ceil(totalPages / PDF_CHUNK_SIZE);
    await reportProgress(job, 35, `PDF 共 ${totalPages} 頁，分割為 ${totalChunks} 個區塊...`);

    const chunks = await splitPdfIntoChunks(pdfBuffer, PDF_CHUNK_SIZE);
    log.info('parser-worker', `Split PDF into ${chunks.length} chunks`, { traceId, totalChunks });

    const chunkResults: { data: ExtractionResponse; meta: LLMMeta }[] = [];

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        await checkCancellation(job, traceId);
        const chunkLabel = `區塊 ${chunkIdx + 1}/${totalChunks}`;
        const chunkPath = path.join(tmpDir, `chunk_${chunkIdx}.pdf`);

        await writeFile(chunkPath, chunks[chunkIdx]);
        await reportProgress(job, 40 + Math.round((chunkIdx / totalChunks) * 40), `${chunkLabel}：正在上傳並萃取...`);

        const chunkResult = await extractQuestionsFromPdf(
            chunkPath,
            `${traceId}__chunk${chunkIdx + 1}`,
            (msg) => { reportProgress(job, 50, `${chunkLabel}：${msg}`).catch(() => {}); }
        );

        chunkResults.push(chunkResult);
        log.info('parser-worker', `${chunkLabel} completed: ${chunkResult.data.questions.length} questions`, {
            traceId,
            chunkIndex: chunkIdx,
            questionsInChunk: chunkResult.data.questions.length,
        });
    }

    const mergedQuestions = chunkResults.flatMap((r) => r.data.questions);
    const extraction: ExtractionResponse = {
        questions: mergedQuestions,
        metadata: {
            year: chunkResults[0]?.data.metadata.year,
            examType: chunkResults[0]?.data.metadata.examType,
            pageCount: totalPages,
        },
    };

    const llmMeta: LLMMeta = {
        provider: chunkResults[0]?.meta.provider ?? "openai",
        model: chunkResults[0]?.meta.model ?? "unknown",
        imageCount: 0,
        totalPayloadMB: chunkResults.reduce((sum, r) => sum + Number(r.meta.totalPayloadMB), 0).toFixed(2),
        totalAttempts: chunkResults.reduce((sum, r) => sum + r.meta.totalAttempts, 0),
        elapsedMs: chunkResults.reduce((sum, r) => sum + r.meta.elapsedMs, 0),
        responseLength: chunkResults.reduce((sum, r) => sum + r.meta.responseLength, 0),
        finishReason: chunkResults.map((r) => r.meta.finishReason).join(","),
        promptTokenCount: chunkResults.reduce((sum, r) => sum + r.meta.promptTokenCount, 0),
        candidatesTokenCount: chunkResults.reduce((sum, r) => sum + r.meta.candidatesTokenCount, 0),
        questionCount: mergedQuestions.length,
        timestamp: new Date().toISOString(),
    };

    await reportProgress(job, 85, `PDF 萃取完成：${mergedQuestions.length} 道題目，正在寫入資料庫`);
    await saveExtractionResult(job, extraction, llmMeta);
}

// ---------------------------------------------------------------------------
// Save extraction result to database
// ---------------------------------------------------------------------------
async function saveExtractionResult(
    job: Job<ParseDocumentJobData>,
    extraction: ExtractionResponse,
    llmMeta: LLMMeta
): Promise<void> {
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
            originalUrl: job.data.s3Key,
            draftJson: extraction as object,
            status: "AWAITING_REVIEW",
            geminiMeta: llmMeta as object,
        },
    });

    await reportProgress(job, 100, '✅ 全部完成，等待人工審核');
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
const QUEUE_POLL_INTERVAL_MS = 5_000;

async function pollQueueCounts(): Promise<void> {
    try {
        const counts = await parserQueue.getJobCounts(
            "waiting", "active", "completed", "failed", "delayed"
        );
        setQueueCounts("parser", {
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

let queuePollTimer: NodeJS.Timeout | undefined;

// 6. Init function to start queue polling (called by orchestrator)
export function startParserPolling() {
    if (!queuePollTimer) {
        queuePollTimer = setInterval(pollQueueCounts, QUEUE_POLL_INTERVAL_MS);
        void pollQueueCounts();
    }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;

export async function shutdownParser(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info('parser-worker', `[${signal}] Initiating graceful shutdown... pausing worker.`);

    // 1. Stop queue polling
    if (queuePollTimer) clearInterval(queuePollTimer);

    // 2. Pause worker to stop picking up new jobs
    await worker.pause(true);

    const GRACEFUL_TIMEOUT_MS = 30_000;

    // 3. Start a hard kill timer
    const timeoutTimer = setTimeout(async () => {
        log.warn('parser-worker', `[${signal}] Timeout ${GRACEFUL_TIMEOUT_MS}ms reached.`);

        // Broad cleanup of tmp directory contents
        await rm(path.join(tmpdir(), "parser-*"), { force: true, recursive: true }).catch(() => { /* best-effort cleanup */ });
    }, GRACEFUL_TIMEOUT_MS);

    try {
        // 4. Wait for currently executing jobs to finish natively
        await worker.close();

        // 5. Close the queue polling connection
        await parserQueue.close();

        clearTimeout(timeoutTimer);
        log.info('parser-worker', `[${signal}] Graceful shutdown complete.`);
    } catch (err) {
        log.error('parser-worker', `[${signal}] Error during shutdown operations`, { error: err instanceof Error ? err.message : String(err) });
    }
}

log.info('parser-worker', 'Worker loaded', {
    concurrency: WORKER_CONCURRENCY,
    lockDuration: LOCK_DURATION_MS,
});

export default worker;
