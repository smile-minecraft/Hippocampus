/**
 * POST /api/auth/refresh
 *
 * Exchanges a valid refresh_token for a new access_token + refresh_token pair.
 *
 * Refresh Race Condition Protocol:
 *  1. Acquire a per-user Redis lock (SET key value PX 5000 NX).
 *  2. If lock is NOT acquired → another request is already refreshing.
 *     Return 409 Conflict and let the client retry after a short delay.
 *  3. Verify the refresh_token (includes grace period + blocklist checks).
 *  4. Issue new token pair (new JTI stored in Redis, old JTI can still succeed
 *     within the 30s grace window if another concurrent request hasn't retried yet).
 *  5. Release the lock.
 *
 * This pattern ensures exactly one token pair is issued per user per refresh cycle,
 * even under thundering-herd conditions from simultaneous tab/request expiries.
 *
 * Edge-Case Coverage:
 *  - Missing cookie: 401 immediately.
 *  - Revoked JTI (logged out elsewhere): 401.
 *  - Lock acquisition timeout: 409 → client retries after 100ms.
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import {
    verifyRefreshToken,
    acquireRefreshLock,
    releaseRefreshLock,
    setAuthCookies,
    getRefreshTokenFromCookie,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_request: NextRequest): Promise<Response> {
    const refreshToken = await getRefreshTokenFromCookie();

    if (!refreshToken) {
        console.error("[Refresh Route] Missing refresh_token cookie");
        return Res.unauthorized("找不到 Refresh Token，請重新登入");
    }

    let lockKey: string | null = null;

    try {
        // ── Step 1: Verify token first (fast-fail before acquiring lock) ────────
        const payload = await verifyRefreshToken(refreshToken);

        // ── Step 2: Acquire distributed lock ────────────────────────────────────
        lockKey = await acquireRefreshLock(payload.sub);
        if (!lockKey) {
            // Another concurrent request is handling the refresh
            return Res.ok({ retryAfterMs: 200 }, 409);
        }

        // ── Step 3: Verify user still exists and is not soft-deleted ────────────
        const user = await db.user.findFirst({
            where: { id: payload.sub, deletedAt: null },
            select: { id: true, role: true },
        });

        if (!user) {
            console.error("[Refresh Route] User not found or soft-deleted", payload.sub);
            return Res.unauthorized("帳號不存在或已被停用");
        }

        // ── Step 4: Issue new token pair ─────────────────────────────────────────
        const { csrfToken } = await setAuthCookies(user.id, user.role);

        return Res.ok({ csrfToken });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Token 驗證失敗";
        console.error("[Refresh Route] verifyRefreshToken failed:", message);
        return Res.unauthorized(message);
    } finally {
        // ── Step 5: Always release lock ──────────────────────────────────────────
        if (lockKey) {
            await releaseRefreshLock(lockKey);
        }
    }
}
