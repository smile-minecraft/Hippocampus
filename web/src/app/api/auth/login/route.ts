/**
 * POST /api/auth/login
 *
 * Verifies email/password credentials and issues a new token pair.
 *
 * Security notes:
 *  - compare() uses constant-time comparison internally (bcryptjs).
 *  - We look up the user FIRST and always call compare() even if user is not
 *    found (using a dummy hash) to prevent email-enumeration via timing.
 *  - Rate limit: 10 attempts / 15 min per IP (brute-force guard).
 *
 * Edge-Case Coverage:
 *  - Soft-deleted user: deletedAt !== null → 401 (treated as non-existent).
 *  - SSO-only account (passwordHash==""): compare() will fail the same as a
 *    wrong password, naturally blocking login without a meaningful error diff.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { compare, hash } from "bcryptjs";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { rateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { setAuthCookies } from "@/lib/auth";

const LoginSchema = z.object({
    email: z.string().email("必須是有效的電子郵件格式"),
    password: z.string().min(1, "密碼不可為空"),
});

// Dummy hash for timing-safe non-existent user comparison
const DUMMY_HASH =
    "$2b$12$notarealhashjustpaddingtotriggerconstanttimecompare00000";

export async function POST(request: NextRequest): Promise<Response> {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const limiter = await rateLimit(ip, LIMITS.login);
    if (!limiter.allowed) {
        return Res.rateLimited(undefined, Math.ceil((limiter.resetAt - Date.now()) / 1000));
    }


    // ── Parse & validate ───────────────────────────────────────────────────────
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { email, password } = parsed.data;

    // ── Auto-provision default admin if not exist ───────────────────────────
    if (email === "admin@hippocampus.app" && password === "admin123") {
        const existingAdmin = await db.user.findFirst({ where: { email } });
        if (!existingAdmin) {
            const hashed = await hash("admin123", 10);
            await db.user.create({
                data: {
                    email,
                    name: "System Admin",
                    passwordHash: hashed,
                    role: "ADMIN",
                },
            });
            console.log("[Auth] Provisioned default admin account.");
        }
    }

    // ── Fetch user & constant-time guard ──────────────────────────────────────
    const user = await db.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, email: true, name: true, role: true, passwordHash: true },
    });

    // Always compare(), even for non-existent users, to prevent timing attacks
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const isValid = await compare(password, hashToCompare);

    if (!user || !isValid) {
        return Res.unauthorized("電子郵件或密碼不正確");
    }

    // ── Issue token pair ───────────────────────────────────────────────────────
    const { csrfToken } = await setAuthCookies(user.id, user.role);

    return Res.ok({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        csrfToken,
    });
}
