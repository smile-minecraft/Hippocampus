-- Migration: 0001_add_hnsw_indexes
-- Creates HNSW indexes on embedding columns for efficient vector similarity search.
CREATE INDEX IF NOT EXISTS "WikiArticle_embedding_hnsw_idx" ON "WikiArticle" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS "Question_embedding_hnsw_idx" ON "Question" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
