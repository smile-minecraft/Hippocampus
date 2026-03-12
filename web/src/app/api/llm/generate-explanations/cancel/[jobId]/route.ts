import { NextRequest, NextResponse } from "next/server";
import { explanationQueue } from "@/lib/queue/jobs";
import { ApiResponse } from "@/types";
import { log } from "@/lib/logger";

export interface CancelJobPayload {
    canceled: boolean;
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<CancelJobPayload>>> {
    try {
        const { jobId } = await context.params;
        const job = await explanationQueue.getJob(jobId);

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
            // Active jobs: mark as paused first, then move to failed
            // This gives the worker a chance to gracefully exit
            await job.updateData({ ...job.data, _cancelRequested: true });
            
            try {
                await job.moveToFailed(
                    new Error('用戶手動取消'),
                    job.token ?? '0',
                    false  // fetchNext = false
                );
            } catch (moveErr) {
                log.warn('explanation', 'moveToFailed failed for active job', {
                    jobId,
                    error: moveErr instanceof Error ? moveErr.message : String(moveErr),
                });
            }
            
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
        log.error('explanation', 'Error canceling job', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "取消任務時發生錯誤" },
            { status: 500 }
        );
    }
}
