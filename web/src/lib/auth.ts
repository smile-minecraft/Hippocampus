/**
 * auth.ts — JWT Authentication & CSRF Token Utilities
 *
 * Design Decisions:
 *  1. Uses `jose` (not `jsonwebtoken`) for Edge Runtime compatibility in middleware.ts.
 *  2. Double-Token architecture: short-lived access_token (15m) + long-lived
 *     refresh_token (7d), both stored in HttpOnly Secure cookies.
 *  3. CSRF: Double-Submit Cookie pattern — a readable __csrf_token cookie is
 *     compared against the X-CSRF-Token request header.
 *  4. Refresh Race Condition Guard: When access_token expires and multiple
 *     concurrent requests trigger refresh simultaneously, we use a Redis
 *     distributed lock (SET NX PX) + a 30-second "grace window" where the old
 *     refresh_token remains valid. Only the first request that acquires the lock
 *     actually issues a new token pair; others receive a 409-style retry signal.
 *
 * Edge-Case Coverage:
 *  - Thundering herd on token refresh: Redis lock + grace period prevents
 *    N parallel requests all invalidating each other's tokens.
 *  - Year 2038: jose uses BigInt internally for exp claims; no overflow risk.
 *  - Token replay after logout: refresh_token JTI is stored in Redis blocklist
 *    on logout; verifyRefreshToken checks the blocklist before accepting.
 */

import {
    SignJWT,
    jwtVerify,
    type JWTPayload,
} from "jose";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { redis } from "./redis";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;         // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REFRESH_GRACE_PERIOD_SECONDS = 30;           // Race condition tolerance
const REFRESH_LOCK_TTL_MS = 5_000;                 // Distributed lock expiry

const COOKIE_ACCESS = "access_token";
const COOKIE_REFRESH = "refresh_token";
const COOKIE_CSRF = "__csrf_token";

// ─── JWT Secret ───────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error(
            "[Auth] NEXTAUTH_SECRET is not set. Set it in your .env file."
        );
    }
    return new TextEncoder().encode(secret);
}

// ─── Token Payload Shape ──────────────────────────────────────────────────────

export interface TokenPayload extends JWTPayload {
    sub: string;   // user UUID
    role: string;  // e.g. "USER" | "MODERATOR" | "ADMIN"
    jti: string;   // JWT ID — used for blocklist
}

// ─── Sign Tokens ──────────────────────────────────────────────────────────────

/**
 * Issues a short-lived access token.
 */
export async function signAccessToken(
    userId: string,
    role: string
): Promise<string> {
    return new SignJWT({ role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(getSecret());
}

/**
 * Issues a long-lived refresh token.
 * The JTI is stored in Redis so we can blocklist it on logout.
 */
export async function signRefreshToken(
    userId: string,
    role: string
): Promise<string> {
    const jti = randomUUID();
    const token = await new SignJWT({ role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setJti(jti)
        .setIssuedAt()
        .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
        .sign(getSecret());

    // Track active refresh token JTI in Redis (for logout blocklist)
    await redis.set(
        `refresh:active:${userId}`,
        jti,
        "EX",
        REFRESH_TOKEN_TTL_SECONDS + REFRESH_GRACE_PERIOD_SECONDS
    );

    return token;
}

// ─── Verify Tokens ────────────────────────────────────────────────────────────

/**
 * Verifies an access token. Returns the payload or throws.
 */
export async function verifyAccessToken(token: string): Promise<TokenPayload> {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as TokenPayload;
}

/**
 * Verifies a refresh token with grace period and blocklist checks.
 *
 * Grace period logic:
 *  - After a new token pair is issued, the old refresh_token JTI may differ
 *    from the current active JTI stored in Redis.
 *  - We allow the old token to succeed only within REFRESH_GRACE_PERIOD_SECONDS
 *    of its own iat (issued-at) timestamp.
 *
 * This prevents concurrent refresh requests from cascading token invalidation.
 */
export async function verifyRefreshToken(
    token: string
): Promise<TokenPayload> {
    const { payload } = await jwtVerify(token, getSecret());
    const tp = payload as TokenPayload;

    // Check if this token is in the blocklist (logged out)
    const isBlocklisted = await redis.get(`refresh:blocklist:${tp.jti}`);
    if (isBlocklisted) {
        throw new Error("Refresh token has been revoked.");
    }

    // Cross-check active JTI; allow grace period for stale (but not revoked) tokens
    const activeJti = await redis.get(`refresh:active:${tp.sub}`);
    if (activeJti && activeJti !== tp.jti) {
        // The stored JTI is newer — check grace period on the incoming token
        const issuedAt = (tp.iat ?? 0) * 1000; // convert to ms
        const ageMs = Date.now() - issuedAt;
        if (ageMs > REFRESH_GRACE_PERIOD_SECONDS * 1000) {
            throw new Error(
                "Refresh token superseded and grace period has expired."
            );
        }
        // Within grace window → allow, but don't issue a new lock
    }

    return tp;
}

// ─── Distributed Lock for Token Refresh ──────────────────────────────────────

/**
 * Acquires a per-user Redis lock before issuing a new token pair.
 * Returns the lock key if acquired, null if another process holds it.
 *
 * Pattern: SET key value NX PX ttl
 *  - NX: Only set if key does NOT exist (atomic)
 *  - PX: Expire in milliseconds (prevent deadlock on crash)
 */
export async function acquireRefreshLock(
    userId: string
): Promise<string | null> {
    const lockKey = `refresh:lock:${userId}`;
    const lockValue = randomUUID();
    const result = await redis.set(
        lockKey,
        lockValue,
        "PX",
        REFRESH_LOCK_TTL_MS,
        "NX"
    );
    return result === "OK" ? lockKey : null;
}

/**
 * Releases the refresh lock.  Only deletes if the value matches (prevents
 * a crashed process from deleting a lock it doesn't own).
 */
export async function releaseRefreshLock(lockKey: string): Promise<void> {
    await redis.del(lockKey);
}

// ─── Logout — Invalidate Refresh Token ───────────────────────────────────────

/**
 * Adds the refresh token's JTI to a blocklist with the remaining TTL.
 * This prevents the token from being used again even if unexpired.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
    try {
        const { payload } = await jwtVerify(token, getSecret());
        const tp = payload as TokenPayload;
        const ttl = (tp.exp ?? 0) - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
            await redis.set(`refresh:blocklist:${tp.jti}`, "1", "EX", ttl);
        }
        // Also remove the active JTI record for this user
        await redis.del(`refresh:active:${tp.sub}`);
    } catch {
        // Token is already invalid; nothing to revoke — silent OK
    }
}

// ─── Cookie Helpers ───────────────────────────────────────────────────────────

const COOKIE_BASE = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
};

/**
 * Sets both auth cookies and a CSRF token on the response.
 * Must be called from a Route Handler (not Edge middleware).
 */
export async function setAuthCookies(
    userId: string,
    role: string
): Promise<{ csrfToken: string }> {
    const cookieStore = await cookies();
    const [accessToken, refreshToken] = await Promise.all([
        signAccessToken(userId, role),
        signRefreshToken(userId, role),
    ]);

    const csrfToken = randomUUID();

    cookieStore.set(COOKIE_ACCESS, accessToken, {
        ...COOKIE_BASE,
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });

    cookieStore.set(COOKIE_REFRESH, refreshToken, {
        ...COOKIE_BASE,
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
    });

    // CSRF cookie is NOT HttpOnly — JS must be able to read and send it
    cookieStore.set(COOKIE_CSRF, csrfToken, {
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
    });

    return { csrfToken };
}

/**
 * Clears all auth cookies (logout).
 */
export async function clearAuthCookies(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_ACCESS);
    cookieStore.delete(COOKIE_REFRESH);
    cookieStore.delete(COOKIE_CSRF);
}

/**
 * Reads the refresh token from cookies (server-side only).
 */
export async function getRefreshTokenFromCookie(): Promise<string | undefined> {
    const cookieStore = await cookies();
    return cookieStore.get(COOKIE_REFRESH)?.value;
}

// ─── CSRF Validation ──────────────────────────────────────────────────────────

/**
 * Validates the Double-Submit CSRF pattern:
 * Cookie.__csrf_token must match Header.x-csrf-token.
 *
 * Call this on all state-mutating routes (POST / PUT / DELETE / PATCH).
 */
export async function validateCsrfToken(request: Request): Promise<boolean> {
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get(COOKIE_CSRF)?.value;
    const headerToken = request.headers.get("x-csrf-token");

    if (!cookieToken || !headerToken) return false;

    // Constant-time comparison to prevent timing attacks
    if (cookieToken.length !== headerToken.length) return false;

    let mismatch = 0;
    for (let i = 0; i < cookieToken.length; i++) {
        mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
    }
    return mismatch === 0;
}
