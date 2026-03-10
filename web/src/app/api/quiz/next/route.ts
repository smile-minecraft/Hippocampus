/**
 * GET /api/quiz/next — Dynamic Weight Algorithm: Retrieve next question
 *
 * Two-stage SQL strategy:
 *  Stage 1 (Pre-filter) — uses B-tree indexes to narrow down to ≤200 candidates.
 *  Stage 2 (Score)      — runs CTE with Wilson Score + decay math on the small set.
 *
 * SQL Injection Prevention:
 *  ALL parameters are passed via Prisma's $queryRaw tagged template literals.
 *  This guarantees parameterized queries — no string interpolation of user data.
 *
 * Weight formula:
 *  S_final = 0.5 * S_decay + 0.2 * S_wilson
 *
 *  S_decay = (1 / (1 + LN(1 + repetitions))) * EXP(-0.1 * days_since_last_answer)
 *    → personalised forgetting curve (high decay = should review soon)
 *
 *  S_wilson = 1 - Wilson_lower_bound(correct_rate, total_attempts)
 *    → community difficulty (hard questions rank higher)
 *    → Falls back to static difficulty ((difficulty-1)/4) when no community data.
 *
 * Edge-Case Coverage:
 *  - No eligible questions: returns 404 with a user-friendly message.
 *  - First-time user (no records): S_decay = 1.0 (max priority) for all questions.
 *  - Zero community attempts: uses static difficulty score instead of Wilson.
 *  - tagSlugs empty / omitted: returns from the full non-deleted question pool.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Res } from "@/lib/api-response";

import { QuizNextSchema } from "@/lib/schemas";


// Shape of the raw SQL result row
interface ScoredQuestion {
  id: string;
  stem: string;
  options: string; // JSON string from Postgres
  answer: string;
  explanation: string | null;
  imageUrls: string[];
  priority_score: number;
}

export async function GET(request: NextRequest): Promise<Response> {
  const userId = request.headers.get("x-user-id")!;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = QuizNextSchema.safeParse(params);
  if (!parsed.success) return Res.fromZodError(parsed.error);

  const tagList = parsed.data.tagSlugs
    ? parsed.data.tagSlugs.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  /*
   * $queryRaw uses tagged template literals — Prisma converts each ${} placeholder
   * into a parameterized bind variable ($1, $2, …) at the driver level.
   * This is categorically safe against SQL injection.
   *
   * Note on the tag filter: we use ANY() with a cast to text[] to pass the array
   * as a single bind parameter. When tagList is empty we pass ['__NO_FILTER__']
   * and the WHERE clause is bypassed via the CASE expression.
   */
  const tagArray = tagList.length > 0 ? tagList : null;

  const results = await db.$queryRaw<ScoredQuestion[]>`
    WITH candidate_ids AS (
      -- Stage 1: B-tree index pre-filter (soft-delete + tag join)
      SELECT DISTINCT q.id
      FROM "Question" q
      ${tagArray !== null
      ? db.$queryRaw`
          JOIN "QuestionTag" qt ON qt."questionId" = q.id
          JOIN "Tag" t ON t.id = qt."tagId"
          WHERE t.slug = ANY(${tagArray}::text[])
            AND q."deletedAt" IS NULL`
      : db.$queryRaw`WHERE q."deletedAt" IS NULL`
    }
      LIMIT 200
    ),

    user_stats AS (
      -- Per-user statistics (only within candidate set)
      SELECT
        r."questionId",
        MAX(r."answeredAt")                                        AS last_answered,
        COUNT(*) FILTER (WHERE r."isCorrect") * 
          CASE WHEN (
            SELECT r2."isCorrect"
            FROM "UserQuestionRecord" r2
            WHERE r2."questionId" = r."questionId" AND r2."userId" = ${userId}
            ORDER BY r2."answeredAt" DESC
            LIMIT 1
          ) THEN 1 ELSE 0 END                                      AS consecutive_correct,
        MAX(r."repetitions")                                       AS repetitions
      FROM "UserQuestionRecord" r
      WHERE r."userId" = ${userId}
        AND r."questionId" IN (SELECT id FROM candidate_ids)
        AND r."deletedAt" IS NULL
      GROUP BY r."questionId"
    ),

    global_stats AS (
      -- Community-wide statistics
      SELECT
        r."questionId",
        COUNT(*)                            AS total_attempts,
        AVG(CAST(r."isCorrect" AS FLOAT))  AS correct_rate
      FROM "UserQuestionRecord" r
      WHERE r."questionId" IN (SELECT id FROM candidate_ids)
        AND r."deletedAt" IS NULL
      GROUP BY r."questionId"
    ),

    scored AS (
      SELECT
        q.id,
        q.stem,
        q.options::text                  AS options,
        q.answer,
        q.explanation,
        q."imageUrls",
        q.difficulty,

        -- Dimension A: personalised memory decay
        CASE
          WHEN us.last_answered IS NULL THEN 1.0
          ELSE (
            1.0 / (1.0 + LN(1.0 + COALESCE(us.repetitions, 0)::FLOAT))
            * EXP(
                -0.1
                * EXTRACT(EPOCH FROM (NOW() - us.last_answered)) / 86400.0
              )
          )
        END AS score_decay,

        -- Dimension C: Wilson Score community difficulty
        CASE
          WHEN COALESCE(gs.total_attempts, 0) = 0
            THEN (q.difficulty - 1)::FLOAT / 4.0
          ELSE 1.0 - (
            (gs.correct_rate + 1.9208 / (2.0 * gs.total_attempts))
            / (1.0 + 3.8416 / gs.total_attempts)
            - (1.96 / (1.0 + 3.8416 / gs.total_attempts))
              * SQRT(
                  gs.correct_rate * (1.0 - gs.correct_rate) / gs.total_attempts
                  + 3.8416 / (4.0 * gs.total_attempts * gs.total_attempts)
                )
          )
        END AS score_wilson

      FROM "Question" q
      INNER JOIN candidate_ids ci ON ci.id = q.id
      LEFT JOIN user_stats  us ON us."questionId" = q.id
      LEFT JOIN global_stats gs ON gs."questionId" = q.id
    )

    SELECT
      id,
      stem,
      options,
      answer,
      explanation,
      "imageUrls"  AS "imageUrls",
      (0.5 * score_decay + 0.2 * score_wilson) AS priority_score
    FROM scored
    ORDER BY priority_score DESC
    LIMIT 1;
  `;

  if (!results || results.length === 0) {
    return Res.notFound("目前沒有符合條件的題目，請嘗試調整標籤範圍");
  }

  const question = results[0];

  // Parse options JSON (returned as string from raw SQL)
  let options: unknown;
  try {
    options = typeof question.options === "string"
      ? JSON.parse(question.options)
      : question.options;
  } catch {
    options = question.options;
  }

  return Res.ok({
    id: question.id,
    stem: question.stem,
    options,
    // Do NOT expose the answer — client receives it only after submitting
    explanation: null,
    imageUrls: question.imageUrls,
    priorityScore: Number(question.priority_score),
  });
}
