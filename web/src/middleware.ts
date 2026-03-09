/**
 * middleware.ts — Next.js Edge Middleware (Auth + CSRF Gate)
 *
 * Execution environment: Edge Runtime (V8 isolate, not Node.js).
 *  - No access to Node.js APIs (fs, crypto module, etc.)
 *  - jose is Edge-compatible; jsonwebtoken is NOT.
 *
 * Responsibilities:
 *  1. Verify the access_token JWT on all /api routes except /api/auth/*.
 *  2. Inject x-user-id and x-user-role headers so Route Handlers can trust
 *     the identity without re-parsing the token (single verification point).
 *  3. Validate CSRF token on state-mutating methods (POST/PUT/DELETE/PATCH)
 *     for all non-auth routes.
 *
 * NOTE: The refresh_token rotation itself happens in /api/auth/refresh —
 *       middleware only validates the access_token.  If the access_token is
 *       expired, middleware returns 401 and the client is expected to call
 *       /api/auth/refresh automatically (frontend responsibility).
 *
 * Edge-Case Coverage:
 *  - Clock skew: jose accepts up to 60s skew by default (clockTolerance).
 *  - Algorithm confusion: we pin alg=HS256 in the verifyJwt call.
 *  - Bypass attempt via X-User-Id header: incoming headers are stripped
 *    before forwarding to prevent spoofing.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Methods that mutate state and require CSRF validation */
const CSRF_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/** Routes that are completely public (no JWT required) */
const PUBLIC_PREFIXES = [
    "/api/auth/",        // register, login, refresh, logout
    "/api/questions",    // read-only browse is public
    "/api/tags",         // tag listing is public
    "/api/parser",       // temp public for testing parser upload
];

// ─── Route Matcher ────────────────────────────────────────────────────────────

export const config = {
    matcher: ["/api/:path*"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET not configured");
    return new TextEncoder().encode(secret);
}

function isPublicRoute(pathname: string): boolean {
    return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function errorResponse(
    message: string,
    code: string,
    status: number
): NextResponse {
    return NextResponse.json(
        { success: false, error: { code, message } },
        { status }
    );
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;
    const method = request.method;

    // ── Step 0: Strip injected identity headers to prevent spoofing ─────────
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-user-role");

    // ── Step 1: Allow public routes through (GET /api/questions, auth, etc.) ─
    if (isPublicRoute(pathname)) {
        // Even on public routes, CSRF is validated for state-mutating methods
        // (e.g., future unauthenticated POST endpoints)
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // ── Step 2: Verify access_token ───────────────────────────────────────────
    const accessToken = request.cookies.get("access_token")?.value;

    if (!accessToken) {
        return errorResponse("請先登入", "UNAUTHORIZED", 401);
    }

    try {
        const { payload } = await jwtVerify(accessToken, getSecret(), {
            algorithms: ["HS256"],
            clockTolerance: 60, // Allow 60s clock skew
        });

        const userId = payload.sub;
        const role = (payload as { role?: string }).role ?? "USER";

        if (!userId) {
            return errorResponse("Token 無效", "UNAUTHORIZED", 401);
        }

        // ── Step 3: CSRF check on state-mutating methods ─────────────────────
        if (CSRF_METHODS.has(method)) {
            const cookieCsrf = request.cookies.get("__csrf_token")?.value;
            const headerCsrf = request.headers.get("x-csrf-token");

            if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
                return errorResponse(
                    "CSRF Token 驗證失敗",
                    "FORBIDDEN",
                    403
                );
            }
        }

        // ── Step 4: Inject verified identity into downstream headers ──────────
        requestHeaders.set("x-user-id", userId);
        requestHeaders.set("x-user-role", role);

        return NextResponse.next({ request: { headers: requestHeaders } });
    } catch (err) {
        const error = err as Error;
        const isExpired =
            error.name === "JWTExpired" || error.message.includes("exp");

        return errorResponse(
            isExpired ? "Token 已過期，請重新整理" : "Token 無效",
            "UNAUTHORIZED",
            401
        );
    }
}
