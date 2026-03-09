/**
 * api-response.ts — Standardized API Envelope
 *
 * All API routes MUST use these helpers to guarantee a uniform response
 * shape. This makes client-side error handling deterministic.
 *
 * Success: { success: true, data: T }
 * Failure: { success: false, error: { code, message, fields? } }
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ─── Error Code Registry ────────────────────────────────────────────────────

export type ApiErrorCode =
    | "VALIDATION_ERROR"    // 400: Zod schema violation
    | "UNAUTHORIZED"        // 401: missing / expired token
    | "FORBIDDEN"           // 403: insufficient role or CSRF mismatch
    | "NOT_FOUND"           // 404: resource does not exist
    | "CONFLICT"            // 409: unique constraint e.g. duplicate email
    | "RATE_LIMITED"        // 429: exceeded request quota
    | "INTERNAL_ERROR";     // 500: unexpected server fault

// ─── Response Types ──────────────────────────────────────────────────────────

interface SuccessEnvelope<T> {
    ok: true;
    data: T;
}

interface ErrorEnvelope {
    ok: false;
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
}

// ─── Factory Helpers ─────────────────────────────────────────────────────────

export function ok<T>(data: T, status = 200): NextResponse<SuccessEnvelope<T>> {
    return NextResponse.json({ ok: true, data }, { status });
}

export function created<T>(data: T): NextResponse<SuccessEnvelope<T>> {
    return ok(data, 201);
}

export function err(
    code: ApiErrorCode,
    message: string,
    status: number,
    fields?: Record<string, string>
): NextResponse<ErrorEnvelope> {
    return NextResponse.json(
        { ok: false, code, message, ...(fields ? { fields } : {}) },
        { status }
    );
}

// ─── Convenience Shortcuts ───────────────────────────────────────────────────

export const Res = {
    ok,
    created,

    badRequest: (message = "請求格式錯誤") =>
        err("VALIDATION_ERROR", message, 400),

    unauthorized: (message = "請先登入") =>
        err("UNAUTHORIZED", message, 401),

    forbidden: (message = "權限不足") =>
        err("FORBIDDEN", message, 403),

    notFound: (message = "資源不存在") =>
        err("NOT_FOUND", message, 404),

    conflict: (message = "資源已存在") =>
        err("CONFLICT", message, 409),

    rateLimited: (message = "請求過於頻繁，請稍後再試", retryAfterSeconds?: number) => {
        const response = err("RATE_LIMITED", message, 429);
        if (retryAfterSeconds) {
            response.headers.set("Retry-After", Math.max(1, retryAfterSeconds).toString());
        }
        return response;
    },


    internal: (message = "伺服器內部錯誤") =>
        err("INTERNAL_ERROR", message, 500),

    /**
     * Converts a ZodError into a 400 response with per-field messages.
     * Ensures the raw schema details are never leaked to the client.
     */
    fromZodError: (error: ZodError): NextResponse<ErrorEnvelope> => {
        const fields: Record<string, string> = {};
        for (const issue of error.issues) {
            const key = issue.path.join(".");
            // Only surface the first error per field
            if (!fields[key]) fields[key] = issue.message;
        }
        return err("VALIDATION_ERROR", "請求格式錯誤，請檢查以下欄位", 400, fields);
    },
};
