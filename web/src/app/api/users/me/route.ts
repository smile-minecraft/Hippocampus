/**
 * GET  /api/users/me — Return the authenticated user's profile.
 * PATCH /api/users/me — Update the authenticated user's profile (name only).
 *
 * Identity comes from the x-user-id header injected by Edge middleware.
 * We re-fetch from DB to ensure we return the latest data (role may have
 * changed since the token was issued).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { validateCsrfToken } from "@/lib/auth";

export async function GET(request: NextRequest): Promise<Response> {
    const userId = request.headers.get("x-user-id");

    // Middleware guarantees this header exists on protected routes,
    // but we guard defensively in case of misconfiguration.
    if (!userId) return Res.unauthorized();

    const user = await db.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            _count: {
                select: { questionRecords: true },
            },
        },
    });

    if (!user) return Res.notFound("用戶不存在");

    return Res.ok(user);
}

// ─── Update profile ───────────────────────────────────────────────────────────

const UpdateProfileSchema = z.object({
    name: z.string().min(1, "姓名不可為空").max(100).optional(),
});

export async function PATCH(request: NextRequest): Promise<Response> {
    // CSRF validation
    const csrfValid = await validateCsrfToken(request);
    if (!csrfValid) return Res.forbidden("CSRF 驗證失敗");

    const userId = request.headers.get("x-user-id");
    if (!userId) return Res.unauthorized();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const updated = await db.user.update({
        where: { id: userId },
        data: parsed.data,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            _count: {
                select: { questionRecords: true },
            },
        },
    });

    return Res.ok(updated);
}
