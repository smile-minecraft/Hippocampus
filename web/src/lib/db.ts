/**
 * db.ts — Unified Prisma Client Singleton (with pgvector extensions)
 *
 * Single source of truth for database access. Combines the basic Prisma client
 * with pgvector extensions for type-safe cosine/L2 distance queries.
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
import { withPGVector } from "prisma-extension-pgvector";

function createPrismaClient() {
    const base = new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "warn", "error"]
                : ["warn", "error"],
    });

    // Mount the pgvector extension for typed vector operations.
    return base
        .$extends(withPGVector({ modelName: "WikiArticle", vectorFieldName: "embedding" }))
        .$extends(withPGVector({ modelName: "Question", vectorFieldName: "embedding" }));
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
    prisma_unified: ExtendedPrismaClient | undefined;
};

export const db: ExtendedPrismaClient =
    globalForPrisma.prisma_unified ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma_unified = db;
}
