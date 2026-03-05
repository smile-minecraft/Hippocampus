/**
 * lib/db/prisma.ts
 * Prisma Client singleton with prisma-extension-pgvector for type-safe
 * cosine / L2 distance queries. Safe for both dev HMR and production.
 */

import { PrismaClient } from "@prisma/client";
import { withPGVector } from "prisma-extension-pgvector";

// Prevent multiple PrismaClient instances in Next.js dev mode (HMR).
const globalForPrisma = globalThis as unknown as {
    prisma: ReturnType<typeof createPrismaClient> | undefined;
};

function createPrismaClient() {
    const base = new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "warn", "error"]
                : ["warn", "error"],
    });

    // Mount the pgvector extension for typed vector operations.
    // Exposes: db.$extends(withPGVector(...)).WikiArticle.findNearestNeighbors(...)
    return base
        .$extends(withPGVector({ modelName: "WikiArticle", vectorFieldName: "embedding" }))
        .$extends(withPGVector({ modelName: "Question", vectorFieldName: "embedding" }));
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

export const db =
    globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = db;
}
