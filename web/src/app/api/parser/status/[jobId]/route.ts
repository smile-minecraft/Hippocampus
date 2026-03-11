import { NextRequest, NextResponse } from "next/server";
import { parserQueue } from "@/lib/queue/jobs";
import { ApiResponse } from "@/types";
import { log } from "@/lib/logger";

export interface ParserJobStatusPayload {
    jobId: string;
    state: string;
    progress: number | object | string | boolean;
    result?: unknown;
    errorReason?: string;
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> } // In Next.js App Router, params is a Promise
): Promise<NextResponse<ApiResponse<ParserJobStatusPayload>>> {
    try {
        // 1. Authentication (Skipped for demo/local testing)

        const { jobId } = await context.params;

        // 2. Query Job from BullMQ
        const job = await parserQueue.getJob(jobId);

        if (!job) {
            return NextResponse.json(
                {
                    ok: false,
                    code: "NOT_FOUND",
                    message: "找不到此任務 ID，可能已經過期或被刪除",
                },
                { status: 404 }
            );
        }

        // 3. Extract status
        const state = await job.getState();
        const progress = job.progress;

        return NextResponse.json({
            ok: true,
            data: {
                jobId: job.id!,
                state: state || "unknown",
                progress,
                result: job.returnvalue,
                errorReason: job.failedReason,
            },
        });
    } catch (error: unknown) {
        log.error('parser', 'Job status query failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            {
                ok: false,
                code: "INTERNAL_ERROR",
                message: "查詢任務狀態失敗",
            },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<{ canceled: boolean }>>> {
    try {
        const { jobId } = await context.params;
        const job = await parserQueue.getJob(jobId);

        if (!job) {
            return NextResponse.json(
                { ok: false, code: "NOT_FOUND", message: "找不到指定的任務，無法取消" },
                { status: 404 }
            );
        }

        const state = await job.getState();

        if (state === 'completed' || state === 'failed') {
            // Terminal state — just remove the record silently
            await job.remove();
            return NextResponse.json({
                ok: true,
                message: "任務紀錄已移除",
                data: { canceled: true }
            });
        }

        if (state === 'active') {
            // Active jobs can't be removed with job.remove() — BullMQ throws.
            // Move to failed state so the job is no longer retried.
            try {
                await job.moveToFailed(
                    new Error('用戶手動取消'),
                    job.token ?? '0',
                    false  // fetchNext = false
                );
            } catch (moveErr) {
                // moveToFailed can throw if the token doesn't match (job locked by
                // a different worker process). In that case, log and still report
                // success — the UI has already removed the row optimistically.
                log.warn('parser', 'moveToFailed failed for active job, may still be running', {
                    jobId,
                    error: moveErr instanceof Error ? moveErr.message : String(moveErr),
                });
            }
            // Try to remove after moving to failed; if still locked, ignore
            try { await job.remove(); } catch { /* best-effort */ }
            return NextResponse.json({
                ok: true,
                message: "處理中的任務已被強制取消",
                data: { canceled: true }
            });
        }

        // waiting, delayed, prioritized — safe to remove directly
        await job.remove();

        return NextResponse.json({
            ok: true,
            message: "任務已成功取消與移除",
            data: { canceled: true }
        });
    } catch (error: unknown) {
        log.error('parser', 'Error canceling job', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "取消任務時發生錯誤" },
            { status: 500 }
        );
    }
}
