# APP ROUTER KNOWLEDGE BASE

## OVERVIEW
Next.js App Router boundary containing scattered API routes and complex client-side management pages.

## WHERE TO LOOK
| Feature | Location | Notes |
|---------|----------|-------|
| API Routes | `api/**/route.ts` | No central registry. Check subdirectories for specific endpoints. |
| Tag Management | `(main)/audit/tags/page.tsx` | Large (>600 lines). Handles tag CRUD, merging, and complex modal states. |
| Auth Routes | `api/auth/` | Login, register, refresh, and dev-login logic. |
| Quiz Engine | `(main)/quiz/engine/page.tsx` | Core quiz interaction logic. |
| Parser UI | `(main)/parser/` | Document parsing and draft management interface. |
| Admin Tools | `api/admin/` | Role-guarded endpoints for users, questions, and tags. |

## CONVENTIONS
- **Validation**: All API routes MUST use Zod for request body and query parameter validation.
- **Responses**: Use `Res` utility from `@/lib/api-response` for consistent JSON output.
- **Role Guards**: Middleware injects `x-user-role`. Routes must check this header for authorization.
- **Client Components**: Use `"use client"` directive only when necessary for hooks or interactivity.
- **Data Fetching**: TanStack Query (React Query) is the standard for client-side state and mutations.
- **Modals**: Complex pages (like Tags) manage multiple modal states via local `useState`.

## ANTI-PATTERNS
- **DO NOT** create a central API index. Routes are self-contained in their respective directories.
- **DO NOT** bypass Zod validation in `route.ts` files.
- **DO NOT** use `alert()` or `confirm()` for critical admin actions; use custom UI components or standard confirmation patterns.
- **AVOID** prop drilling in large pages; prefer local composition or specialized components.
- **NEVER** hardcode role checks without verifying the middleware-injected headers.
