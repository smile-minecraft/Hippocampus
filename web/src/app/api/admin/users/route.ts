/**
 * GET   /api/admin/users          — List all users with pagination (ADMIN only)
 * PATCH /api/admin/users/[id]/role — Change a user's role (ADMIN only)
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";

import { GetUsersSchema, PatchRoleSchema } from "@/lib/schemas";


function requireAdmin(request: NextRequest): boolean {
    return request.headers.get("x-user-role") === "ADMIN";
}

export async function GET(request: NextRequest): Promise<Response> {
    if (!requireAdmin(request)) return Res.forbidden("需要管理員權限");

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetUsersSchema.safeParse(params);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { page, limit, search } = parsed.data;

    const where = {
        deletedAt: null,
        ...(search
            ? {
                OR: [
                    { email: { contains: search, mode: "insensitive" as const } },
                    { name: { contains: search, mode: "insensitive" as const } },
                ],
            }
            : {}),
    };

    const [users, total] = await Promise.all([
        db.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                _count: { select: { questionRecords: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        db.user.count({ where }),
    ]);

    return Res.ok({
        users,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
}

// ─── PATCH (role change) — lives at /api/admin/users/[id]/role ───────────────
// This file handles the parent route; the [id]/role nested route is below.
// To keep it in one file we export a named handler for the dynamic segment.




/**
 * Used internally by /api/admin/users/[id]/role/route.ts
 * Exported as a shared handler to avoid code duplication.
 */
export async function patchUserRole(
    request: NextRequest,
    targetUserId: string
): Promise<Response> {
    if (!requireAdmin(request)) return Res.forbidden("需要管理員權限");

    const requestingUserId = request.headers.get("x-user-id")!;
    if (requestingUserId === targetUserId) {
        return Res.forbidden("不可修改自己的角色");
    }

    let body: unknown;
    try { body = await request.json(); }
    catch { return Res.badRequest("請求 body 必須是有效的 JSON"); }

    const parsed = PatchRoleSchema.safeParse({
        ...(body as Record<string, unknown>),
        userId: targetUserId,
    });
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const user = await db.user.findFirst({
        where: { id: targetUserId, deletedAt: null },
    });
    if (!user) return Res.notFound("用戶不存在");

    const updated = await db.user.update({
        where: { id: targetUserId },
        data: { role: parsed.data.role },
        select: { id: true, email: true, role: true },
    });

    return Res.ok(updated);
}
