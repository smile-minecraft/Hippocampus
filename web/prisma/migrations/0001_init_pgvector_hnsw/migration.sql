-- Migration: 0001_init_pgvector_hnsw
-- Creates pgvector extension and HNSW indexes on embedding columns.
-- This migration is intentionally split from the Prisma auto-generated DDL
-- so that the HNSW parameters can be tuned independently.
-- Enable pgvector extension (Prisma schema declares it, but we keep this
-- here as a safety net for environments that bypass prisma migrate)
CREATE EXTENSION IF NOT EXISTS vector;
-- =============================================================================
-- HNSW Indexes on embedding columns
-- Parameters:
--   m=16              : connections per layer (balances precision / memory)
--   ef_construction=64: beam width during index build (index quality)
-- Query-time: SET hnsw.ef_search = 40 per session for ANN tuning
-- =============================================================================
CREATE INDEX IF NOT EXISTS "WikiArticle_embedding_hnsw_idx" ON "WikiArticle" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS "Question_embedding_hnsw_idx" ON "Question" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);