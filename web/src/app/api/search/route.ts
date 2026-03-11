/**
 * GET /api/search — RAG Semantic Search via pgvector
 *
 * Flow:
 *  1. Rate limit (20 req/min — Embedding API cost protection).
 *  2. Validate query string (1–500 chars).
 *  3. Embed query via configured provider (EmbedTaskType.RETRIEVAL_QUERY).
 *  4. Run pgvector cosine distance query with optional tag metadata filter.
 *  5. Return top-K results with similarity scores.
 *
 * SQL Injection Prevention:
 *  All parameters use Prisma $queryRaw tagged template literals.
 *  The embedding vector is cast to ::vector inside the parameterized query.
 *
 * pgvector operator: <=> = cosine distance (0 = identical, 2 = opposite).
 *  similarity = 1 - (embedding <=> query_vector)
 *
 * Edge-Case Coverage:
 *  - No embeddings indexed yet: returns empty results (not an error).
 *  - Embedding API failure: propagates as 500 with structured log.
 *  - Empty query: Zod rejects min(1).
 *  - XSS via query string: Zod max(500) + embedding API treats it as text.
 */

import { NextRequest } from "next/server";
import { Res } from "@/lib/api-response";
import { rateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { embed, EmbedTaskType } from "@/lib/embedding";
import { db } from "@/lib/db";

import { SearchSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";


interface SearchResult {
  id: string;
  stem: string;
  year: number | null;
  examType: string | null;
  difficulty: number;
  similarity: number;
}

export async function GET(request: NextRequest): Promise<Response> {
  // ── Rate limit ─────────────────────────────────────────────────────────────
  const identifier =
    request.headers.get("x-user-id") ?? getClientIp(request);
  const limiter = await rateLimit(identifier, LIMITS.search);
  if (!limiter.allowed) return Res.rateLimited();

  // ── Validate ───────────────────────────────────────────────────────────────
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = SearchSchema.safeParse(params);
  if (!parsed.success) return Res.fromZodError(parsed.error);

  const { q, tagSlugs, topK } = parsed.data;
  const tagList = tagSlugs
    ? tagSlugs.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // ── Generate query embedding ───────────────────────────────────────────────
  let queryVector: number[];
  try {
    queryVector = await embed(q, EmbedTaskType.RETRIEVAL_QUERY);
  } catch (err) {
    log.error('search', 'Embedding generation failed', { error: err instanceof Error ? err.message : String(err) });
    return Res.internal("向量生成失敗，請稍後再試");
  }

  // ── pgvector similarity search ─────────────────────────────────────────────
  // Vector is serialized to Postgres array literal format: '[0.1, 0.2, ...]'
  const vectorLiteral = `[${queryVector.join(",")}]`;

  try {
    /**
     * The embedding column is Unsupported("vector(1024)") in Prisma schema,
     * so we MUST use $queryRaw.  The vector literal is passed as a parameterized
     * bind variable and cast to ::vector inside SQL — NOT string-interpolated.
     *
     * Tag metadata filter is applied via a correlated EXISTS subquery which
     * also uses parameterized arrays (ANY($2::text[])).
     */
    const results = tagList !== null
      ? await db.$queryRaw<SearchResult[]>`
          SELECT
            q.id,
            q.stem,
            q.year,
            q."examType",
            q.difficulty,
            (1 - (q.embedding <=> ${vectorLiteral}::vector)) AS similarity
          FROM "Question" q
          WHERE q."deletedAt" IS NULL
            AND q.embedding IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM "QuestionTag" qt
              JOIN "Tag" t ON t.id = qt."tagId"
              WHERE qt."questionId" = q.id
                AND t.slug = ANY(${tagList}::text[])
            )
          ORDER BY q.embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK};
        `
      : await db.$queryRaw<SearchResult[]>`
          SELECT
            q.id,
            q.stem,
            q.year,
            q."examType",
            q.difficulty,
            (1 - (q.embedding <=> ${vectorLiteral}::vector)) AS similarity
          FROM "Question" q
          WHERE q."deletedAt" IS NULL
            AND q.embedding IS NOT NULL
          ORDER BY q.embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK};
        `;

    return Res.ok({
      query: q,
      results: results.map((r) => ({
        ...r,
        similarity: Number(r.similarity),
      })),
      total: results.length,
    });
  } catch (err) {
    log.error('search', 'pgvector query failed', { error: err instanceof Error ? err.message : String(err) });
    return Res.internal("搜尋失敗，請稍後再試");
  }
}
