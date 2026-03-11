-- Migration: 0000_baseline
-- Baseline migration marking the current database state as already migrated.
-- The database already has all tables created via `prisma db push`.
SELECT 1; -- No-op migration
