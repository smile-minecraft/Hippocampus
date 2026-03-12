/**
 * GET /api/llm/generate-explanations/status/[jobId]
 *
 * Poll the status of an explanation generation job.
 * Returns progress (done/total), partial results, and final results.
 *
 * Response:
 * {
 *   ok: true,
 *   data: {
 *     jobId: string,
 *     state: "waiting" | "active" | "completed" | "failed" | ...,
 *     progress: { done, total, cached, partialResults, message },
 *     result?: { explanations: Record<number, string> },
 *     errorReason?: string
 *   }
 * }
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import { log } from "@/lib/logger";
import { explanationQueue } from "@/lib/queue/jobs";

export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> },
) {
    try {
        const { jobId } = await context.params;
        const job = await explanationQueue.getJob(jobId);

        if (!job) {
            return Res.notFound("找不到此任務 ID，可能已經過期或被刪除");
        }

        const state = await job.getState();
        const progress = job.progress;

        return Res.ok({
            jobId: job.id!,
            state: state || "unknown",
            progress,
            result: job.returnvalue,
            errorReason: job.failedReason,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("llm", "Explanation job status query failed", { error: message });
        return Res.internal("查詢解釋生成任務狀態失敗");
    }
}
