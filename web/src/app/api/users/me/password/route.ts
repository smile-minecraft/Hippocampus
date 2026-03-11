/**
 * POST /api/users/me/password — Change the authenticated user's password.
 *
 * Requires:
 *  - currentPassword: verified against the stored bcrypt hash
 *  - newPassword: must satisfy the same rules as registration (8+ chars, uppercase, digit)
 *
 * Security:
 *  - CSRF validation (Double-Submit Cookie)
 *  - bcrypt compare for current password (constant-time)
 *  - bcrypt hash for new password (cost=12)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { compare, hash } from "bcryptjs";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";
import { validateCsrfToken } from "@/lib/auth";

const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, "請輸入目前密碼"),
    newPassword: z
        .string()
        .min(8, "新密碼長度至少 8 個字元")
        .max(72, "密碼長度不可超過 72 字元（bcrypt 限制）")
        .regex(/[A-Z]/, "新密碼必須包含至少一個大寫字母")
        .regex(/[0-9]/, "新密碼必須包含至少一個數字"),
});

export async function POST(request: NextRequest): Promise<Response> {
    // CSRF validation
    const csrfValid = await validateCsrfToken(request);
    if (!csrfValid) return Res.forbidden("CSRF 驗證失敗");

    const userId = request.headers.get("x-user-id");
    if (!userId) return Res.unauthorized();

    // Parse body
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Res.badRequest("請求 body 必須是有效的 JSON");
    }

    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) return Res.fromZodError(parsed.error);

    const { currentPassword, newPassword } = parsed.data;

    // Fetch user with password hash
    const user = await db.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, passwordHash: true },
    });

    if (!user) return Res.notFound("用戶不存在");

    // Verify current password
    if (!user.passwordHash) {
        return Res.badRequest("此帳號未設定密碼（SSO 帳號）");
    }

    const isValid = await compare(currentPassword, user.passwordHash);
    if (!isValid) {
        return Res.badRequest("目前密碼不正確");
    }

    // Prevent setting the same password
    const isSame = await compare(newPassword, user.passwordHash);
    if (isSame) {
        return Res.badRequest("新密碼不可與目前密碼相同");
    }

    // Hash and save
    const newHash = await hash(newPassword, 12);
    await db.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
    });

    return Res.ok({ message: "密碼修改成功" });
}
