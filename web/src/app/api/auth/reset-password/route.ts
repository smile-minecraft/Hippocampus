import { NextRequest } from "next/server";
import { z } from "zod";
import { jwtVerify } from "jose";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

const ResetPasswordSchema = z.object({
    token: z.string().min(1, "Token 不可為空"),
    password: z.string().min(8, "密碼長度至少需為 8 個字元"),
});

function getSecret(): Uint8Array {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error("[Auth] NEXTAUTH_SECRET is not set.");
    }
    return new TextEncoder().encode(secret);
}

export async function POST(request: NextRequest): Promise<Response> {
    // Rate limiting: 10 attempts per 15 mins
    const ip = getClientIp(request);
    const limiter = await rateLimit(ip, { endpoint: "reset-password", maxRequests: 10, windowMs: 15 * 60 * 1000 });
    if (!limiter.allowed) {
        return Res.rateLimited(undefined, Math.ceil((limiter.resetAt - Date.now()) / 1000));
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = ResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { token, password } = parsed.data;

    let payload;
    try {
        const verified = await jwtVerify(token, getSecret());
        payload = verified.payload;
        
        if (payload.purpose !== "password_reset") {
            return Res.badRequest("無效的 token 類型");
        }
    } catch (err) {
        log.error('auth', 'Password reset token verification failed', { error: err });
        return Res.badRequest("重設連結無效或已過期");
    }

    const userId = payload.sub;
    if (!userId) {
        return Res.badRequest("重設連結無效：缺少使用者識別碼");
    }

    // Verify user exists and is not deleted
    const user = await db.user.findFirst({
        where: { id: userId, deletedAt: null },
    });

    if (!user) {
        return Res.badRequest("使用者不存在或已刪除");
    }

    // Update password
    const passwordHash = await hash(password, 12);
    
    await db.user.update({
        where: { id: user.id },
        data: { passwordHash },
    });

    log.info('auth', `Password reset successful for user ${user.id}`);

    return Res.ok({ message: "密碼重設成功" });
}
