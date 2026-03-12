/**
 * lib/queue/jobs.ts
 * Type-safe BullMQ job definitions for the Hippocampus worker pipelines.
 * All job payloads are validated via Zod at enqueue time to enforce
 * the Fail-Fast principle — corrupt jobs are rejected before hitting the queue.
 */

import { Queue } from "bullmq";
import { z } from "zod";
import { redisConnection } from "./client";

// ---------------------------------------------------------------------------
// Queue name constants
// ---------------------------------------------------------------------------
export const QUEUE_NAMES = {
    PARSER: "hippocampus-parser",
    EXPLANATION: "hippocampus-explanations",
} as const;

// ---------------------------------------------------------------------------
// Job payload schemas (Zod)
// ---------------------------------------------------------------------------

/**
 * ParseDocumentJob — sent when a user uploads a Word or PDF file.
 *
 * Design note: we store the file in MinIO raw bucket BEFORE enqueueing,
 * so the worker receives an s3Key (not a raw buffer). This decouples
 * the upload from parse latency and prevents OOM from large in-memory buffers.
 */
export const ParseDocumentJobSchema = z.object({
    /** BullMQ Job ID (duplicated here for downstream tracing in logs) */
    traceId: z.string().uuid(),
    /** Uploader's user ID */
    uploadedBy: z.string().uuid(),
    /** Type of document */
    docType: z.enum(["word", "pdf"]),
    /** MinIO raw bucket key where the file has been stored */
    s3Key: z.string().min(1),
    /** Original filename for user-facing display */
    originalFilename: z.string().min(1),
    /** Approx file size in bytes — used to estimate processing time */
    fileSizeBytes: z.number().int().nonnegative(),
    /** Flag set by API when user requests cancellation */
    _cancelRequested: z.boolean().optional(),
});

export type ParseDocumentJobData = z.infer<typeof ParseDocumentJobSchema>;

// ---------------------------------------------------------------------------
// Queue instances
// ---------------------------------------------------------------------------

export const parserQueue = new Queue<ParseDocumentJobData>(
    QUEUE_NAMES.PARSER,
    {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 2_000, // 2s → 4s → 8s
            },
            removeOnComplete: { age: 7 * 24 * 3600 }, // Keep 7 days
            removeOnFail: { age: 30 * 24 * 3600 },    // Keep failed jobs 30 days
        },
    }
);

// ---------------------------------------------------------------------------
// Type-safe enqueue helper
// ---------------------------------------------------------------------------

/**
 * Enqueue a document parsing job.
 * Validates payload with Zod before adding to the queue.
 * Throws ZodError if payload is invalid (Fail-Fast).
 */
export async function enqueueParseJob(
    payload: ParseDocumentJobData
): Promise<{ jobId: string }> {
    // Validate — throws ZodError on invalid input
    const validated = ParseDocumentJobSchema.parse(payload);

    const job = await parserQueue.add("parse-document", validated, {
        jobId: validated.traceId, // Idempotency: same traceId → no duplicate
    });

    if (!job.id) {
        throw new Error("BullMQ failed to return a job ID after enqueue");
    }

    return { jobId: job.id };
}

// ===========================================================================
// Explanation Generation Pipeline
// ===========================================================================

/**
 * LLM speed mode — determines which model to use.
 * - "fast"    → gpt-4o-mini (non-reasoning, ~3-5x faster)
 * - "precise" → gpt-5-mini  (reasoning model, higher quality)
 */
export const ExplanationModelMode = z.enum(["fast", "precise"]);
export type ExplanationModelMode = z.infer<typeof ExplanationModelMode>;

/** A single question payload for explanation generation. */
const ExplanationQuestionSchema = z.object({
    /** Original index in the draft (used to reassemble results in order) */
    index: z.number().int().nonnegative(),
    stem: z.string().min(1),
    options: z.record(z.string()),
    answer: z.string().min(1),
});

export type ExplanationQuestion = z.infer<typeof ExplanationQuestionSchema>;

/**
 * GenerateExplanationsJob — sent when a user requests batch AI explanation
 * generation for an entire draft.
 *
 * The worker processes questions in small groups with 3-way LLM parallelism,
 * caches results by content hash, and reports per-question progress.
 */
export const GenerateExplanationsJobSchema = z.object({
    /** BullMQ Job ID / trace ID */
    traceId: z.string().uuid(),
    /** Draft ID that the explanations belong to */
    draftId: z.string().uuid(),
    /** User who requested the generation */
    requestedBy: z.string().uuid(),
    /** LLM speed mode */
    model: ExplanationModelMode,
    /** Questions to generate explanations for (1–500) */
    questions: z.array(ExplanationQuestionSchema).min(1).max(500),
});

export type GenerateExplanationsJobData = z.infer<
    typeof GenerateExplanationsJobSchema
>;

// ---------------------------------------------------------------------------
// Explanation Queue instance
// ---------------------------------------------------------------------------

export const explanationQueue = new Queue<GenerateExplanationsJobData>(
    QUEUE_NAMES.EXPLANATION,
    {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 2,
            backoff: {
                type: "exponential",
                delay: 10_000, // 10s → 20s (LLM calls are slow, longer backoff)
            },
            removeOnComplete: { age: 7 * 24 * 3600 },
            removeOnFail: { age: 30 * 24 * 3600 },
        },
    }
);

// ---------------------------------------------------------------------------
// Type-safe enqueue helper
// ---------------------------------------------------------------------------

/**
 * Enqueue an explanation generation job.
 * Validates payload with Zod before adding to the queue.
 */
export async function enqueueExplanationJob(
    payload: GenerateExplanationsJobData
): Promise<{ jobId: string }> {
    const validated = GenerateExplanationsJobSchema.parse(payload);

    const job = await explanationQueue.add(
        "generate-explanations",
        validated,
        {
            jobId: validated.traceId,
        }
    );

    if (!job.id) {
        throw new Error("BullMQ failed to return a job ID after enqueue");
    }

    return { jobId: job.id };
}
