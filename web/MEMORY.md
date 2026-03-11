# Hippocampus Knowledge & Learnings

## Technical Choices
- **Auth**: Stateless JWT in HTTPOnly cookies, CSRF via Double-Submit Cookie pattern. We chose this over a database Session table to save read/write latency. Reset Password also uses a short-lived 15m JWT sent via email to avoid adding a `PasswordResetToken` schema.
- **Queue & Async**: BullMQ and Redis are used. Background workers run via `tsx --watch src/workers/parser.worker.ts`.
- **Database**: PostgreSQL + Prisma + pgvector.

## Implementation Details
- Next.js client component `useSearchParams` hook requires wrapping with React `<Suspense>` in the parent to avoid Next.js build errors and CSR bailout issues.
- Forms should have `disabled={loading}` on inputs/buttons.
