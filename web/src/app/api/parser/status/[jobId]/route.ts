import { NextRequest, NextResponse } from "next/server";
import { parserQueue } from "@/lib/queue/jobs";
import { ApiResponse } from "@/types";

export interface ParserJobStatusPayload {
    jobId: string;
    state: string;
    progress: number | object | string | boolean;
    result?: any;
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
    } catch (error: any) {
        console.error("[ParserStatusAPI] Error:", error);
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

        // BullMQ job.remove() removes the job from the queue and cancels it if it hasn't started
        await job.remove();

        return NextResponse.json({
            ok: true,
            message: "任務已成功取消與移除",
            data: { canceled: true }
        });
    } catch (error: any) {
        console.error("[ParserStatusAPI] Error canceling job:", error);
        return NextResponse.json(
            { ok: false, code: "INTERNAL_ERROR", message: "取消任務時發生錯誤" },
            { status: 500 }
        );
    }
}
