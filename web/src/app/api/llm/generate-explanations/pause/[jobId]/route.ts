import { NextRequest, NextResponse } from "next/server";
import { explanationQueue } from "@/lib/queue/jobs";
import { ApiResponse } from "@/types";
import { log } from "@/lib/logger";

export interface PauseJobPayload {
    paused: boolean;
}

/**
 * POST /api/llm/generate-explanations/pause/[jobId]
 * Pause an active or waiting explanation generation job
 */
export async function POST(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<PauseJobPayload>>> {
    try {
        const { jobId } = await context.params;
        const job = await explanationQueue.getJob(jobId);

        if (!job) {
            return NextResponse.json(
                { ok: false, code: "NOT_FOUND", message: "找不到指定的任務" },
                { status: 404 }
            );
        }

        const state = await job.getState();

        // Can only pause active or waiting jobs
        if (state !== 'active' && state !== 'waiting' && state !== 'prioritized') {
            return NextResponse.json({
                ok: false,
                code: "INVALID_STATE",
                message: `任務目前狀態為 ${state}，無法暫停`,
            }, { status: 400 });
        }

        // Mark job as paused in data
        // Worker will check this flag and pause processing
        await job.updateData({ 
            ...job.data, 
            _paused: true,
            _pausedAt: new Date().toISOString()
        });

        log.info('explanation', `Job ${jobId} paused by user`, { jobId, state });

        return NextResponse.json({
            ok: true,
            message: "任務已暫停",
            data: { paused: true }
        });
    } catch (error: unknown) {
        log.error('explanation', 'Error pausing job', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "暫停任務時發生錯誤" },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/llm/generate-explanations/pause/[jobId]
 * Resume a paused explanation generation job
 */
export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<PauseJobPayload>>> {
    try {
        const { jobId } = await context.params;
        const job = await explanationQueue.getJob(jobId);

        if (!job) {
            return NextResponse.json(
                { ok: false, code: "NOT_FOUND", message: "找不到指定的任務" },
                { status: 404 }
            );
        }

        // Remove pause flags from job data
        const newData = { ...job.data };
        delete newData._paused;
        delete newData._pausedAt;
        
        await job.updateData(newData);

        log.info('explanation', `Job ${jobId} resumed by user`, { jobId });

        return NextResponse.json({
            ok: true,
            message: "任務已恢復",
            data: { paused: false }
        });
    } catch (error: unknown) {
        log.error('explanation', 'Error resuming job', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "恢復任務時發生錯誤" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/llm/generate-explanations/pause/[jobId]
 * Check if a job is paused
 */
export async function GET(
    req: NextRequest,
    context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<PauseJobPayload>>> {
    try {
        const { jobId } = await context.params;
        const job = await explanationQueue.getJob(jobId);

        if (!job) {
            return NextResponse.json(
                { ok: false, code: "NOT_FOUND", message: "找不到指定的任務" },
                { status: 404 }
            );
        }

        const isPaused = !!job.data._paused;

        return NextResponse.json({
            ok: true,
            data: { paused: isPaused }
        });
    } catch (error: unknown) {
        log.error('explanation', 'Error checking pause status', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "檢查暫停狀態時發生錯誤" },
            { status: 500 }
        );
    }
}
