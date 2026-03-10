/**
 * POST /api/auth/logout
 *
 * Clears all auth cookies and revokes the refresh token JTI in Redis.
 * Subsequent requests with the old refresh_token will be rejected.
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import { clearAuthCookies, getRefreshTokenFromCookie, revokeRefreshToken } from "@/lib/auth";
import { log } from "@/lib/logger";

export async function POST(_request: NextRequest): Promise<Response> {
    const refreshToken = await getRefreshTokenFromCookie();

    // Revoke the refresh token JTI in Redis (best-effort; don't block on failure)
    if (refreshToken) {
        await revokeRefreshToken(refreshToken).catch((err) => {
            log.warn('auth', 'Failed to revoke refresh token', { error: (err as Error).message });
        });
    }

    await clearAuthCookies();

    return Res.ok({ message: "已成功登出" });
}
