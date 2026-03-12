# LIB KNOWLEDGE BASE

**Generated:** 2026-03-12

## OVERVIEW
Core infrastructure layer for database, AI, caching, and API resilience.

## WHERE TO LOOK
| File/Dir | Role | Notes |
|----------|------|-------|
| `apiClient.ts` | Central fetch wrappers | Large file (>500 lines), handles all API calls. |
| `embedding.ts` | Vector embedding logic | Similarity query rules and embedding generation. |
| `db.ts` | Database client | Connection management and core DB utilities. |
| `cache.ts` | LLM Caching | Content-addressed SHA-256 caching for LLM responses. |
| `ai/` | AI Utilities | Model configurations and prompt management. |
| `db/` | DB Schemas | Database schemas and migration-related logic. |
| `redis.ts` | Redis Client | Redis client for BullMQ and general caching. |

## CONVENTIONS
- **API**: Use `apiClient.ts` for all frontend-to-backend communication.
- **Validation**: Use `schemas.ts` for Zod validation across API and DB layers.

## ANTI-PATTERNS
- **AVOID** direct `fetch` calls; use `apiClient.ts` wrappers.
