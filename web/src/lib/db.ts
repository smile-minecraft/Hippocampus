/**
 * db.ts — Prisma Client Singleton
 *
 * Pattern: re-use a single PrismaClient instance across hot-reloads in
 * Next.js development (prevents "too many connections" warnings).
 *
 * Edge-Case Coverage:
 *  - Thundering herd: module-level singleton guarantees a single instance.
 *  - OOM: Prisma manages connection pool internally; no extra pooling layer needed
 *    for single-instance dev.  For production, point DATABASE_URL at PgBouncer.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma_v2: PrismaClient | undefined;
};

export const db =
    globalForPrisma.prisma_v2 ??
    new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "warn", "error"]
                : ["error"],
    });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma_v2 = db;
}
