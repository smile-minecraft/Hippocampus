/**
 * workers/explanation.worker.ts
 * BullMQ Worker — AI Explanation Generation Pipeline
 *
 * Pipeline per job:
 *   1. Receive question list + model mode (fast/precise)
 *   2. Batch-lookup explanation cache (Redis MGET) → split into cached/uncached
 *   3. Group uncached questions into small batches (3-5 questions each)
 *   4. Process batches with 3-way LLM parallelism via cockatiel bulkhead
 *   5. Write new explanations to cache (Redis pipeline)
 *   6. Merge cached + newly generated results, ordered by original index
 *   7. Return final results array
 *
 * Resilience:
 *   - cockatiel: bulkhead(3,6) → circuitBreaker(5) → retry(2) → timeout(dynamic)
 *   - Content-addressed cache: identical questions are never re-generated
 *   - Partial progress: reported per-batch via job.updateProgress()
 *   - Graceful shutdown with SIGTERM/SIGINT handling
 */

import { Worker, type Job, Queue } from "bullmq";
import { log, setLogSink } from "../lib/logger";
import {
    bulkhead,
    retry,
    handleAll,
    ExponentialBackoff,
    circuitBreaker,
    ConsecutiveBreaker,
    timeout,
    TimeoutStrategy,
    wrap,
} from "cockatiel";
import { redisConnection } from "../lib/queue/client";
import {
    QUEUE_NAMES,
    explanationQueue,
    type GenerateExplanationsJobData,
    type ExplanationQuestion,
    type ExplanationModelMode,
} from "../lib/queue/jobs";
import {
    questionContentHash,
    batchGetExplanations,
    batchSetExplanations,
} from "../lib/cache/explanation-cache";

// TUI store — ink components consume this reactively
import {
    upsertJob,
    removeJob,
    setQueueCounts,
    appendLog,
    setWorkerMeta,
} from "./tui/store.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Worker concurrency: 1 job at a time (each job uses 3-way LLM parallelism) */
const WORKER_CONCURRENCY = 1;

/** Lock must exceed maximum possible job duration: 500 questions × ~2 min/batch */
const LOCK_DURATION_MS = 1_800_000; // 30 minutes

/** Questions per LLM call */
const LLM_BATCH_SIZE = 5;

/** Max concurrent LLM requests */
const LLM_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

interface ModelConfig {
    model: string;
    isReasoning: boolean;
    timeoutMs: number;
    /** Timeout per question for dynamic scaling */
    perQuestionMs: number;
}

function getModelConfig(mode: ExplanationModelMode): ModelConfig {
    if (mode === "fast") {
        return {
            model: process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini",
            isReasoning: false,
            timeoutMs: 120_000,      // 2 min base
            perQuestionMs: 5_000,    // +5s per question
        };
    }
    // precise
    const model = process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini";
    return {
        model,
        isReasoning: /^(o[134]|gpt-5)/.test(model),
        timeoutMs: 180_000,       // 3 min base
        perQuestionMs: 15_000,    // +15s per question (reasoning models are slower)
    };
}

// ---------------------------------------------------------------------------
// System prompt (shared with the sync API route)
// ---------------------------------------------------------------------------

const EXPLANATION_SYSTEM_PROMPT = `你是一位經驗豐富的醫學教育專家。你的任務是為醫學考試題目撰寫詳細解析。

規則：
1. 所有輸出必須使用繁體中文。
2. 解析應涵蓋：為什麼正確答案是正確的、為什麼其他選項是錯誤的。
3. 加入相關的醫學知識背景說明，幫助學生理解核心概念。
4. 使用 KaTeX 行內語法 $...$ 處理化學式、分子式、上下標和希臘字母。
5. 回答格式為 JSON 陣列，每個元素是一個字串（對應一題的解析）。
6. 輸出範例：["解析內容...", "解析內容..."]
7. 只輸出 JSON 陣列，不要加 markdown 圍欄或其他文字。
8. 解析中不要包含題號，如「第1題」、「第N題」、「1.」等格式。`;

// ---------------------------------------------------------------------------
// Cockatiel resilience policies
// ---------------------------------------------------------------------------

function createBulkheadPolicy() {
    return bulkhead(LLM_CONCURRENCY, 100); // Increased queue size from 6 to 100
}

function createTimeoutPolicy(questionCount: number, config: ModelConfig) {
    const ms = config.timeoutMs + config.perQuestionMs * questionCount;
    return timeout(ms, TimeoutStrategy.Aggressive);
}

const retryPolicy = retry(handleAll, {
    maxAttempts: 2,
    backoff: new ExponentialBackoff({
        initialDelay: 5_000,
        maxDelay: 30_000,
    }),
});

function createCircuitBreakerPolicy() {
    return circuitBreaker(handleAll, {
        halfOpenAfter: 60_000,
        breaker: new ConsecutiveBreaker(5),
    });
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callLLM(
    questions: ExplanationQuestion[],
    config: ModelConfig,
    bulkheadPolicy: ReturnType<typeof createBulkheadPolicy>,
    circuitBreakerPolicy: ReturnType<typeof createCircuitBreakerPolicy>,
): Promise<string> {
    const apiUrl = process.env.OPENAI_API_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.OPENAI_API_KEY ?? "";

    const userPrompt = questions
        .map((q) => {
            const opts = Object.entries(q.options)
                .map(([k, v]) => `  (${k}) ${v}`)
                .join("\n");
            return `【第${q.index + 1}題】\n題幹：${q.stem}\n選項：\n${opts}\n正確答案：${q.answer}`;
        })
        .join("\n\n");

    const timeoutPolicy = createTimeoutPolicy(questions.length, config);
    const policy = wrap(bulkheadPolicy, circuitBreakerPolicy, retryPolicy, timeoutPolicy);

    return policy.execute(async ({ signal }) => {
        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            signal,
            body: JSON.stringify({
                model: config.model,
                messages: [
                    {
                        role: config.isReasoning ? "developer" : "system",
                        content: EXPLANATION_SYSTEM_PROMPT,
                    },
                    { role: "user", content: userPrompt },
                ],
                ...(config.isReasoning
                    ? { max_completion_tokens: 65536 }
                    : { temperature: 0.3 }),
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`LLM API HTTP ${response.status}: ${body.slice(0, 300)}`);
        }

        const json = (await response.json()) as {
            choices: Array<{ message: { content: string | null } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new Error("LLM returned empty content");
        return content;
    });
}

// ---------------------------------------------------------------------------
// JSON extraction (mirrors sync route logic)
// ---------------------------------------------------------------------------

function extractJsonArray(raw: string): string[] {
    let cleaned = raw.trim();

    // Strip markdown fences
    cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/```\s*$/, "")
        .trim();

    // Try to find array if not starting with [
    if (!cleaned.startsWith("[")) {
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) cleaned = arrayMatch[0];
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) {
            throw new Error("Expected JSON array but got " + typeof parsed);
        }
        return parsed.map((item) => (typeof item === "string" ? item : String(item)));
    } catch {
        // Fallback: extract quoted strings
        const matches = cleaned.match(/"([^"]+)"/g);
        if (matches && matches.length > 0) {
            return matches.map((m) => m.slice(1, -1));
        }
        throw new Error(`Failed to parse LLM response as JSON array: ${cleaned.slice(0, 200)}`);
    }
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

/** Job progress data shape — frontend polls this via status API */
export interface ExplanationJobProgress {
    /** Questions completed so far */
    done: number;
    /** Total questions in the job */
    total: number;
    /** Number of cache hits (skipped LLM) */
    cached: number;
    /** Partial results so far (index → explanation), sparse */
    partialResults: Record<number, string>;
    /** Human-readable status message */
    message: string;
}

async function reportProgress(
    job: Job<GenerateExplanationsJobData>,
    progress: ExplanationJobProgress,
): Promise<void> {
    await job.updateProgress(progress);
    upsertJob(job.id!, "explanation", {
        percent: Math.round((progress.done / progress.total) * 100),
        message: progress.message,
    });
}

/**
 * Check if job is paused or canceled. If paused, wait until resumed.
 * Throws error if canceled.
 */
async function checkPauseAndCancel(
    job: Job<GenerateExplanationsJobData>,
    traceId: string
): Promise<void> {
    // Check for cancel request
    if (job.data._cancelRequested) {
        log.info("explanation-worker", `Job ${job.id} canceled by user`, { traceId, jobId: job.id });
        throw new Error("任務已被用戶取消");
    }

    // Check for pause - wait until resumed
    if (job.data._paused) {
        log.info("explanation-worker", `Job ${job.id} paused, waiting for resume...`, { traceId, jobId: job.id });
        
        // Update progress to show paused state
        await reportProgress(job, {
            done: job.progress?.done || 0,
            total: job.progress?.total || 0,
            cached: job.progress?.cached || 0,
            partialResults: job.progress?.partialResults || {},
            message: "已暫停，等待恢復...",
        });

        // Poll every 1 second to check if still paused
        while (job.data._paused) {
            // Re-fetch job to get latest data
            const freshJob = await explanationQueue.getJob(job.id!);
            if (!freshJob) {
                throw new Error("任務已不存在");
            }
            
            // Update job reference
            Object.assign(job.data, freshJob.data);
            
            // Check for cancel while paused
            if (job.data._cancelRequested) {
                log.info("explanation-worker", `Job ${job.id} canceled while paused`, { traceId, jobId: job.id });
                throw new Error("任務已被用戶取消");
            }

            // If still paused, wait
            if (job.data._paused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        log.info("explanation-worker", `Job ${job.id} resumed`, { traceId, jobId: job.id });
    }
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------

async function processExplanationJob(
    job: Job<GenerateExplanationsJobData>,
): Promise<{ explanations: Record<number, string> }> {
    const { traceId, draftId, model: mode, questions } = job.data;
    const total = questions.length;
    const config = getModelConfig(mode);
    const bulkheadPolicy = createBulkheadPolicy();
    const circuitBreakerPolicy = createCircuitBreakerPolicy();

    upsertJob(job.id!, "explanation", {
        filename: `Draft ${draftId.slice(0, 8)} (${total} 題, ${mode})`,
        percent: 0,
        message: "開始處理...",
    });

    log.info("explanation-worker", `Job started: ${traceId}`, {
        jobId: job.id,
        draftId,
        mode,
        model: config.model,
        questionCount: total,
    });

    // === Phase 1: Cache lookup ===
    const hashEntries = questions.map((q) => ({
        index: q.index,
        hash: questionContentHash(q),
    }));

    const cacheResult = await batchGetExplanations(mode, hashEntries);
    const cachedCount = cacheResult.hits.size;

    log.info("explanation-worker", `Cache lookup: ${cachedCount} hits, ${cacheResult.misses.length} misses`, {
        traceId,
        cached: cachedCount,
        uncached: cacheResult.misses.length,
    });

    // Build results map (start with cached values)
    const results: Record<number, string> = {};
    for (const [idx, explanation] of cacheResult.hits) {
        results[idx] = explanation;
    }

    let doneCount = cachedCount;

    await reportProgress(job, {
        done: doneCount,
        total,
        cached: cachedCount,
        partialResults: results,
        message: cachedCount > 0
            ? `快取命中 ${cachedCount}/${total} 題，剩餘 ${cacheResult.misses.length} 題需要 AI 生成`
            : `共 ${total} 題需要 AI 生成`,
    });

    // === Phase 2: Process uncached questions ===
    if (cacheResult.misses.length > 0) {
        // Build a lookup: index → question
        const questionMap = new Map<number, ExplanationQuestion>();
        for (const q of questions) {
            questionMap.set(q.index, q);
        }

        // Split uncached indices into LLM batches
        const uncachedBatches: ExplanationQuestion[][] = [];
        for (let i = 0; i < cacheResult.misses.length; i += LLM_BATCH_SIZE) {
            const batchIndices = cacheResult.misses.slice(i, i + LLM_BATCH_SIZE);
            const batchQuestions = batchIndices
                .map((idx) => questionMap.get(idx))
                .filter((q): q is ExplanationQuestion => q !== undefined);
            if (batchQuestions.length > 0) {
                uncachedBatches.push(batchQuestions);
            }
        }

        const totalBatches = uncachedBatches.length;

        log.info("explanation-worker", `Processing ${cacheResult.misses.length} uncached questions in ${totalBatches} batches (concurrency: ${LLM_CONCURRENCY})`, {
            traceId,
            batchSize: LLM_BATCH_SIZE,
            totalBatches,
            concurrency: LLM_CONCURRENCY,
        });

        // Process batches with retry logic (max 3 attempts per batch)
        const cacheWrites: Array<{ hash: string; explanation: string }> = [];
        const MAX_BATCH_RETRIES = 3;
        const BATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per batch attempt

        interface BatchResult {
            success: boolean;
            batchIdx: number;
            error?: string;
            retried: number;
        }

        async function processSingleBatch(
            batch: ExplanationQuestion[],
            batchIdx: number,
            totalBatches: number
        ): Promise<BatchResult> {
            const batchLabel = `批次 ${batchIdx + 1}/${totalBatches}`;
            let lastError = "";

            for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
                try {
                    const raw = await Promise.race([
                        callLLM(batch, config, bulkheadPolicy, circuitBreakerPolicy),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error("Batch timeout")), BATCH_TIMEOUT_MS)
                        )
                    ]);
                    
                    const explanations = extractJsonArray(raw);

                    // Map results back to question indices
                    for (let i = 0; i < batch.length; i++) {
                        const explanation = i < explanations.length ? explanations[i] : "";
                        const q = batch[i];
                        results[q.index] = explanation;

                        // Prepare cache write
                        const hashEntry = hashEntries.find((e) => e.index === q.index);
                        if (hashEntry && explanation) {
                            cacheWrites.push({ hash: hashEntry.hash, explanation });
                        }
                    }

                    doneCount += batch.length;

                    await reportProgress(job, {
                        done: doneCount,
                        total,
                        cached: cachedCount,
                        partialResults: { ...results },
                        message: `已完成 ${batchIdx + 1}/${totalBatches} 批次 (${doneCount}/${total})`,
                    });

                    const retryInfo = attempt > 1 ? ` (重試 ${attempt - 1} 次後成功)` : "";
                    log.info("explanation-worker", `${batchLabel} completed${retryInfo}`, {
                        traceId,
                        batchIndex: batchIdx,
                        questionsInBatch: batch.length,
                        explanationsReturned: explanations.length,
                        attempt,
                    });

                    return { success: true, batchIdx, retried: attempt - 1 };
                } catch (err) {
                    const errName = err instanceof Error ? err.name : "Unknown";
                    const message = err instanceof Error ? err.message : String(err);
                    lastError = message;

                    if (attempt < MAX_BATCH_RETRIES) {
                        // Wait before retry with exponential backoff
                        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                        log.warn("explanation-worker", `${batchLabel} failed (attempt ${attempt}/${MAX_BATCH_RETRIES}), retrying in ${delayMs}ms`, {
                            traceId,
                            batchIndex: batchIdx,
                            attempt,
                            error: message,
                        });
                        await new Promise(r => setTimeout(r, delayMs));
                    } else {
                        // Max retries exceeded, mark as failed
                        log.error("explanation-worker", `${batchLabel} failed after ${MAX_BATCH_RETRIES} attempts`, {
                            traceId,
                            batchIndex: batchIdx,
                            errorName: errName,
                            error: message,
                        });

                        // Mark these questions as empty (failed) but continue
                        for (const q of batch) {
                            if (!(q.index in results)) {
                                results[q.index] = "";
                            }
                        }
                        doneCount += batch.length;

                        let userMessage = message;
                        if (errName === "CircuitBrokenError" || message.includes("circuit")) {
                            userMessage = "電路熔斷，已跳過此批次";
                        } else if (message.includes("timeout") || errName === "TimeoutError") {
                            userMessage = "請求超時";
                        } else if (message.includes("429") || message.includes("rate limit")) {
                            userMessage = "速率限制";
                        } else if (message.includes("bulkhead") || message.includes("capacity")) {
                            userMessage = "容量超出限制";
                        }

                        await reportProgress(job, {
                            done: doneCount,
                            total,
                            cached: cachedCount,
                            partialResults: { ...results },
                            message: `${batchLabel} 失敗: ${userMessage.slice(0, 80)}`,
                        });

                        return { success: false, batchIdx, error: message, retried: MAX_BATCH_RETRIES - 1 };
                    }
                }
            }

            // Should never reach here, but TypeScript requires it
            return { success: false, batchIdx, error: lastError, retried: MAX_BATCH_RETRIES };
        }

        // Process batches in parallel with limited concurrency (LLM_CONCURRENCY at a time)
        const batchResults: BatchResult[] = [];
        let completedBatches = 0;
        
        // Check for pause/cancel before starting
        await checkPauseAndCancel(job, traceId);
        
        for (let i = 0; i < uncachedBatches.length; i += LLM_CONCURRENCY) {
            // Check for pause/cancel before each chunk
            await checkPauseAndCancel(job, traceId);
            
            const batchChunk = uncachedBatches.slice(i, i + LLM_CONCURRENCY);
            const chunkPromises = batchChunk.map((batch, idx) => 
                processSingleBatch(batch, i + idx, totalBatches)
            );
            const chunkResults = await Promise.all(chunkPromises);
            completedBatches += chunkResults.length;
            batchResults.push(...chunkResults);
        }

        log.info("explanation-worker", `All ${totalBatches} batches processed`, { 
            traceId, 
            totalBatches,
            resultsCount: batchResults.length 
        });

        // Count results
        const failures = batchResults.filter(r => !r.success).length;
        const totalRetries = batchResults.reduce((sum, r) => sum + r.retried, 0);

        // Log detailed results
        if (failures > 0 || totalRetries > 0) {
            log.warn("explanation-worker", `${failures}/${totalBatches} batches failed, ${totalRetries} total retries`, { 
                traceId, 
                failures, 
                totalBatches,
                totalRetries 
            });
            
            // Log failed batches
            batchResults.forEach((r) => {
                if (!r.success) {
                    log.warn("explanation-worker", `Batch ${r.batchIdx + 1} failed: ${r.error}`, { traceId, batchIndex: r.batchIdx });
                } else if (r.retried > 0) {
                    log.info("explanation-worker", `Batch ${r.batchIdx + 1} succeeded after ${r.retried} retries`, { traceId, batchIndex: r.batchIdx });
                }
            });
        }

        // === Phase 3: Write new explanations to cache ===
        if (cacheWrites.length > 0) {
            await batchSetExplanations(mode, cacheWrites);
            log.info("explanation-worker", `Cached ${cacheWrites.length} new explanations`, {
                traceId,
                newlyCached: cacheWrites.length,
            });
        }
    }

    // === Final progress ===
    // Count actual successful generations
    const successfulGenerations = Object.values(results).filter(e => e && e.length > 0).length;
    const failedCount = total - successfulGenerations;
    
    const completionMessage = failedCount > 0 
        ? `完成 ${successfulGenerations}/${total} 題解釋生成 (${failedCount} 題失敗, 快取 ${cachedCount} 題)`
        : `完成 ${total} 題解釋生成 (快取 ${cachedCount} 題)`;

    await reportProgress(job, {
        done: total,
        total,
        cached: cachedCount,
        partialResults: results,
        message: completionMessage,
    });

    log.info("explanation-worker", `Job completed: ${traceId}`, {
        jobId: job.id,
        total,
        cached: cachedCount,
        generated: total - cachedCount,
        successful: successfulGenerations,
        failed: failedCount,
        resultKeys: Object.keys(results).length,
    });

    return { explanations: results };
}

// ---------------------------------------------------------------------------
// Worker bootstrap + TUI
// ---------------------------------------------------------------------------

// 1. Wire logger → TUI store
setLogSink(({ level, service, message, timestamp, meta }) => {
    appendLog({ level, service, message, timestamp, meta });
});

// 2. Create the BullMQ worker
const worker = new Worker<GenerateExplanationsJobData>(
    QUEUE_NAMES.EXPLANATION,
    processExplanationJob,
    {
        connection: redisConnection,
        concurrency: WORKER_CONCURRENCY,
        lockDuration: LOCK_DURATION_MS,
        stalledInterval: 60_000, // Check every 60s (jobs are long-running)
    },
);

// 3. Populate TUI metadata
const provider = process.env.LLM_PROVIDER ?? "openai";
setWorkerMeta({ concurrency: WORKER_CONCURRENCY, provider });

// 4. Worker lifecycle events
worker.on("completed", (job) => {
    removeJob(job.id!);
    log.info("explanation-worker", "Job completed", {
        event: "job_completed",
        jobId: job.id,
        traceId: job.data.traceId,
    });
});

worker.on("failed", (job, err) => {
    if (job?.id) removeJob(job.id);
    log.error("explanation-worker", "Job failed", {
        event: "job_failed",
        jobId: job?.id,
        traceId: job?.data.traceId,
        message: err.message,
    });
});

worker.on("stalled", (jobId) => {
    log.warn("explanation-worker", "Job stalled", { event: "job_stalled", jobId });
});

// 5. Poll queue counts for TUI
const explanationQueue = new Queue(QUEUE_NAMES.EXPLANATION, { connection: redisConnection });
const QUEUE_POLL_INTERVAL_MS = 5_000;

async function pollQueueCounts(): Promise<void> {
    try {
        const counts = await explanationQueue.getJobCounts(
            "waiting", "active", "completed", "failed", "delayed",
        );
        setQueueCounts("explanation", {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
        });
    } catch {
        // Silently ignore transient Redis failures
    }
}

let queuePollTimer: NodeJS.Timeout | undefined;

export function startExplanationPolling() {
    if (!queuePollTimer) {
        queuePollTimer = setInterval(pollQueueCounts, QUEUE_POLL_INTERVAL_MS);
        void pollQueueCounts();
    }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

export async function shutdownExplanation(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info("explanation-worker", `[${signal}] Initiating graceful shutdown...`);

    if (queuePollTimer) clearInterval(queuePollTimer);
    await worker.pause(true);

    const GRACEFUL_TIMEOUT_MS = 60_000;

    const timeoutTimer = setTimeout(() => {
        log.warn("explanation-worker", `[${signal}] Grace period expired. Exiting (code 1).`);
    }, GRACEFUL_TIMEOUT_MS);

    try {
        await worker.close();
        await explanationQueue.close();
        clearTimeout(timeoutTimer);
        log.info("explanation-worker", `[${signal}] Graceful shutdown complete.`);
    } catch (err) {
        log.error("explanation-worker", `[${signal}] Error during shutdown`, {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

log.info("explanation-worker", "Worker loaded", {
    concurrency: WORKER_CONCURRENCY,
    lockDuration: LOCK_DURATION_MS,
    llmConcurrency: LLM_CONCURRENCY,
    llmBatchSize: LLM_BATCH_SIZE,
});

export default worker;
