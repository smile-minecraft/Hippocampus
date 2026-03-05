/**
 * GET /api/users/me — Return the authenticated user's profile.
 *
 * Identity comes from the x-user-id header injected by Edge middleware.
 * We re-fetch from DB to ensure we return the latest data (role may have
 * changed since the token was issued).
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";

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
