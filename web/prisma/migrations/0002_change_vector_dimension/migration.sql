-- Migration: 0002_change_vector_dimension
-- Changes embedding columns from vector(1024) to vector(1536)
-- This is for switching from Qwen3-Embedding to OpenAI text-embedding-3-small
--
-- IMPORTANT: Existing embedding data will be lost and must be regenerated.
-- Run the regeneration script after this migration.

-- Drop existing HNSW indexes first
DROP INDEX IF EXISTS "WikiArticle_embedding_hnsw_idx";
DROP INDEX IF EXISTS "Question_embedding_hnsw_idx";

-- Recreate embedding columns with new dimension (pgvector requires column recreation)
ALTER TABLE "WikiArticle" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "WikiArticle" ADD COLUMN "embedding" vector(1536);

ALTER TABLE "Question" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "Question" ADD COLUMN "embedding" vector(1536);

-- Recreate HNSW indexes with new dimension
CREATE INDEX IF NOT EXISTS "WikiArticle_embedding_hnsw_idx" ON "WikiArticle" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS "Question_embedding_hnsw_idx" ON "Question" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
