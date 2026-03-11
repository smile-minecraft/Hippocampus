import { NextRequest } from "next/server";
import { z } from "zod";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

const ForgotPasswordSchema = z.object({
    email: z.string().email("必須是有效的電子郵件格式"),
});

function getSecret(): Uint8Array {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error("[Auth] NEXTAUTH_SECRET is not set.");
    }
    return new TextEncoder().encode(secret);
}

export async function POST(request: NextRequest): Promise<Response> {
    // Rate limiting: 5 attempts per 15 mins for forgot password (prevent email spam)
    const ip = getClientIp(request);
    const limiter = await rateLimit(ip, { endpoint: "forgot-password", maxRequests: 5, windowMs: 15 * 60 * 1000 });
    if (!limiter.allowed) {
        return Res.rateLimited(undefined, Math.ceil((limiter.resetAt - Date.now()) / 1000));
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = ForgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { email } = parsed.data;

    // We do not want to leak whether the email exists or not.
    // So we'll always return success to the client.
    
    const user = await db.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, email: true },
    });

    if (user) {
        // Generate stateless JWT for password reset
        // Include user ID and email
        const token = await new SignJWT({ email: user.email, purpose: "password_reset" })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject(user.id)
            .setIssuedAt()
            .setExpirationTime("15m") // Token valid for 15 minutes
            .sign(getSecret());

        // Construct reset link
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
        const resetLink = `${baseUrl}/reset-password?token=${token}`;

        // TODO: Replace with actual email sending logic (e.g. Resend, AWS SES)
        log.info('auth', `Password reset link for ${user.email}: ${resetLink}`);
        console.log(`[EMAIL MOCK] Password reset link for ${user.email}: ${resetLink}`);
    }

    return Res.ok({ message: "重設連結已發送" });
}
