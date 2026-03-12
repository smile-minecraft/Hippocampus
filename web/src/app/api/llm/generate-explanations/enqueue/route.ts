/**
 * POST /api/llm/generate-explanations/enqueue
 *
 * Enqueue an AI explanation generation job into the BullMQ worker system.
 * Returns a jobId that the frontend polls via the status endpoint.
 *
 * Request body:
 * {
 *   draftId: string (UUID),
 *   model: "fast" | "precise",
 *   questions: Array<{ index, stem, options, answer }>
 * }
 *
 * Response:
 * { ok: true, data: { jobId: string } }
 */

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Res } from "@/lib/api-response";
import { log } from "@/lib/logger";
import {
    enqueueExplanationJob,
    ExplanationModelMode,
} from "@/lib/queue/jobs";

export const dynamic = "force-dynamic";

// ─── Request Schema ──────────────────────────────────────────────────────────

const EnqueueRequestSchema = z.object({
    draftId: z.string().uuid(),
    model: ExplanationModelMode,
    questions: z
        .array(
            z.object({
                index: z.number().int().nonnegative(),
                stem: z.string().min(1),
                options: z.record(z.string(), z.string()),
                answer: z.string().min(1),
            })
        )
        .min(1)
        .max(500),
});

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const userId = req.headers.get("x-user-id");
        if (!userId) {
            return Res.unauthorized("需要登入才能使用此功能");
        }

        const body = await req.json();
        const parsed = EnqueueRequestSchema.safeParse(body);

        if (!parsed.success) {
            return Res.fromZodError(parsed.error);
        }

        const { draftId, model, questions } = parsed.data;
        const traceId = randomUUID();

        log.info("llm", "Enqueuing explanation generation job", {
            traceId,
            draftId,
            model,
            questionCount: questions.length,
            userId,
        });

        const { jobId } = await enqueueExplanationJob({
            traceId,
            draftId,
            requestedBy: userId,
            model,
            questions,
        });

        return Res.ok({ jobId });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("llm", "Failed to enqueue explanation job", { error: message });
        return Res.internal("建立解釋生成任務失敗");
    }
}
