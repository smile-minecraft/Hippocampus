/**
 * POST /api/auth/register
 *
 * Creates a new USER-role account with a bcrypt-hashed password.
 * Enforces Zod schema validation and returns a standardized error envelope
 * on any violation.
 *
 * Rate limit: 5 registrations per IP per hour (LIMITS.register).
 *
 * Edge-Case Coverage:
 *  - Duplicate email: Prisma P2002 unique constraint is caught and mapped to 409.
 *  - Timing attack on email discovery: we always bcrypt-hash before checking
 *    uniqueness, making error-path timing indistinguishable from success-path.
 *    (Acceptable trade-off for registration; for login see login/route.ts.)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { rateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { setAuthCookies } from "@/lib/auth";
import { log } from "@/lib/logger";

const RegisterSchema = z.object({
    email: z
        .string()
        .email("必須是有效的電子郵件格式")
        .max(255, "電子郵件不可超過 255 字元"),
    password: z
        .string()
        .min(8, "密碼長度至少 8 個字元")
        .max(72, "密碼長度不可超過 72 字元（bcrypt 限制）")
        .regex(/[A-Z]/, "密碼必須包含至少一個大寫字母")
        .regex(/[0-9]/, "密碼必須包含至少一個數字"),
    name: z.string().min(1, "姓名不可為空").max(100).optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const limiter = await rateLimit(ip, LIMITS.register);
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

    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
        return Res.fromZodError(parsed.error);
    }

    const { email, password, name } = parsed.data;

    // ── Hash password (bcrypt cost=12, ~250ms — deliberate slowdown) ──────────
    const passwordHash = await hash(password, 12);

    // ── Create user ────────────────────────────────────────────────────────────
    try {
        const user = await db.user.create({
            data: { email, name: name ?? null, passwordHash },
            select: { id: true, email: true, name: true, role: true },
        });

        // Auto-login after registration
        const { csrfToken } = await setAuthCookies(user.id, user.role);

        return Res.created({ user, csrfToken });
    } catch (err: unknown) {
        // Prisma unique constraint violation (email already exists)
        if (
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "P2002"
        ) {
            return Res.conflict("該電子郵件已被註冊");
        }

        log.error('auth', 'Unexpected registration error', { error: err instanceof Error ? err.message : String(err) });
        return Res.internal();
    }
}
