# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-12

## OVERVIEW
Hybrid Next.js + BullMQ worker architecture project. The core application is nested inside the `web/` directory instead of the repository root. Features a custom development orchestrator (`dev.ts`) and a Terminal UI (TUI) for real-time monitoring of workers.

## STRUCTURE
```
.
├── test/        # Non-standard root test directory
├── web/         # Contains the actual Next.js application and worker code
│   ├── src/
│   │   ├── app/        # Next.js App Router (pages and API)
│   │   ├── workers/    # BullMQ workers and TUI orchestration
│   │   ├── lib/        # Core utilities, DB clients, and AI clients
│   │   └── components/ # UI components (some very large like AuditWorkstation)
└── tsconfig.json # Root config (references missing 'docs/' dir)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Dev script | `web/src/dev.ts` | Custom Next.js + Worker orchestrator |
| Workers | `web/src/workers/` | BullMQ worker files and TUI |
| API | `web/src/app/api/` | Next.js API routes (scattered) |
| Tests | `web/src/**/__tests__/` | Vitest test suites |
| Embeddings | `web/src/lib/embedding.ts` | Similarity query rules |

## CONVENTIONS
- **Testing**: Vitest is used (no Jest). Configured in `web/vitest.config.ts`. Tests belong in `__tests__` folders adjacent to the code they test, using the `.test.ts` extension. Extensive use of `vi` for mocking.
- **Workers**: BullMQ workers use `concurrency=1`, report progress to both BullMQ and the TUI store, and handle graceful shutdown.
- **Resilience Stack**: Cockatiel policies (bulkhead + circuit breaker + retry + timeout) are heavily used for AI and external operations.
- **Database Resilience**: Upsert operations are favored to handle race conditions, especially in worker error states.
- **Async**: Heavy use of `Promise.all` for parallel execution (LLM batches, file processing) with configurable concurrency via env vars.

## ANTI-PATTERNS (THIS PROJECT)
- **DO NOT** use `cosineSimilarity` in production search paths. It is explicitly forbidden. All similarity queries MUST use pgvector's `<=>` operator via SQL.

## UNIQUE STYLES
- **Caching**: LLM responses are cached using content-addressed SHA-256 hashes of question content.
- **TUI Integration**: Workers log their output directly to a reactive TUI store.

## COMMANDS
```bash
# Run the custom dev orchestrator
cd web && npx tsx --env-file .env src/dev.ts

# Tests
cd web && npm run test
```

## NOTES
- No standard `npm run dev` for just Next.js; everything runs via the orchestrator.
- API documentation is minimal and routes are scattered.
- Several large files (e.g., `AuditWorkstation.tsx`, `parser.worker.ts`, `tags/page.tsx`) represent complexity hotspots. Ensure focused edits when modifying these files.