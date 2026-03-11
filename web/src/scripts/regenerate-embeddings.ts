/* eslint-disable no-console -- standalone CLI script */
/**
 * scripts/regenerate-embeddings.ts
 * 
 * Regenerates all embeddings for WikiArticles and Questions using the new
 * OpenAI text-embedding-3-small model (1536 dimensions).
 * 
 * Usage:
 *   npx tsx src/scripts/regenerate-embeddings.ts
 * 
 * Prerequisites:
 *   1. Run database migration first: npx prisma migrate deploy
 *   2. Ensure OPENAI_API_KEY is set in .env
 */

import { PrismaClient } from "@prisma/client"
import { embed, EmbedTaskType, EMBEDDING_DIMENSIONS } from "../lib/embedding"

// Use a raw PrismaClient (without pgvector extension) so we can call
// $executeRawUnsafe for the Unsupported vector column.
const prisma = new PrismaClient()

async function regenerateWikiArticleEmbeddings() {
    console.log("\n--- Regenerating WikiArticle embeddings...")

    const articles = await prisma.wikiArticle.findMany({
        where: { deletedAt: null },
        select: { id: true, title: true, content: true }
    })

    console.log(`    Found ${articles.length} articles`)

    let processed = 0
    let failed = 0

    for (const article of articles) {
        try {
            const textToEmbed = `${article.title}\n\n${article.content || ""}`.trim()
            
            if (!textToEmbed) {
                console.log(`    Skipping article ${article.id} (empty content)`)
                continue
            }

            const vector = await embed(textToEmbed, EmbedTaskType.RETRIEVAL_DOCUMENT)

            // Prisma Unsupported columns can't be set via .update() — use raw SQL
            const vectorStr = `[${vector.join(",")}]`
            await prisma.$executeRawUnsafe(
                `UPDATE "WikiArticle" SET "embedding" = $1::vector WHERE "id" = $2`,
                vectorStr,
                article.id
            )

            processed++
            if (processed % 50 === 0) {
                console.log(`    Progress: ${processed}/${articles.length}`)
            }
        } catch (error) {
            failed++
            console.error(`    Failed article ${article.id}:`, error instanceof Error ? error.message : String(error))
        }
    }

    console.log(`    WikiArticles: ${processed} success, ${failed} failed`)
    return { processed, failed }
}

async function regenerateQuestionEmbeddings() {
    console.log("\n--- Regenerating Question embeddings...")

    const questions = await prisma.question.findMany({
        where: { deletedAt: null },
        select: { 
            id: true, 
            stem: true, 
            options: true, 
            explanation: true,
            examType: true,
            year: true
        }
    })

    console.log(`    Found ${questions.length} questions`)

    let processed = 0
    let failed = 0

    for (const question of questions) {
        try {
            const textToEmbed = [
                question.examType || "",
                question.year ? `(${question.year})` : "",
                question.stem,
                question.options ? JSON.stringify(question.options) : "",
                question.explanation || ""
            ].filter(Boolean).join("\n\n")

            if (!textToEmbed) {
                console.log(`    Skipping question ${question.id} (empty content)`)
                continue
            }

            const vector = await embed(textToEmbed, EmbedTaskType.RETRIEVAL_DOCUMENT)

            // Prisma Unsupported columns can't be set via .update() — use raw SQL
            const vectorStr = `[${vector.join(",")}]`
            await prisma.$executeRawUnsafe(
                `UPDATE "Question" SET "embedding" = $1::vector WHERE "id" = $2`,
                vectorStr,
                question.id
            )

            processed++
            if (processed % 50 === 0) {
                console.log(`    Progress: ${processed}/${questions.length}`)
            }
        } catch (error) {
            failed++
            console.error(`    Failed question ${question.id}:`, error instanceof Error ? error.message : String(error))
        }
    }

    console.log(`    Questions: ${processed} success, ${failed} failed`)
    return { processed, failed }
}

async function main() {
    console.log("Starting embedding regeneration...")
    console.log(`    Model: OpenAI text-embedding-3-small (${EMBEDDING_DIMENSIONS} dimensions)`)

    const startTime = Date.now()

    try {
        const wikiResult = await regenerateWikiArticleEmbeddings()
        const questionResult = await regenerateQuestionEmbeddings()

        const totalTime = Date.now() - startTime
        const totalProcessed = wikiResult.processed + questionResult.processed
        const totalFailed = wikiResult.failed + questionResult.failed

        console.log("\n" + "=".repeat(50))
        console.log(`Summary:`)
        console.log(`    Total processed: ${totalProcessed}`)
        console.log(`    Total failed: ${totalFailed}`)
        console.log(`    Time elapsed: ${(totalTime / 1000).toFixed(1)}s`)
        console.log("=".repeat(50))

        if (totalFailed > 0) {
            console.log("\nSome embeddings failed. Check the errors above and rerun if needed.")
            process.exit(1)
        } else {
            console.log("\nAll embeddings regenerated successfully!")
        }
    } catch (error) {
        console.error("\nFatal error:", error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
