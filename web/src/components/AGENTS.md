# COMPONENTS KNOWLEDGE BASE

## OVERVIEW
React components for the Next.js frontend, ranging from shared UI primitives to complex domain-specific workstations.

## WHERE TO LOOK
| Domain | Location | Notes |
|--------|----------|-------|
| Audit | `audit/` | Question review and approval workflow. `AuditWorkstation.tsx` is the primary entry point. |
| Parser | `parser/` | Components for parsing and formatting warnings (e.g., `FormatWarningBadge.tsx`). |
| Quiz | `quiz/` | Interactive quiz interface, including keyboard navigation and tag selection. |
| Wiki | `wiki/` | Article reading and related question discovery. |
| UI | `ui/` | Shared atomic components (Button, Skeleton) and specialized display components (LatexText). |
| Providers | `providers/` | Global React context providers (AppProviders). |

## CONVENTIONS
- **Client Components**: Most components use `'use client'` for interactive state.
- **Styling**: Tailwind CSS via `cn()` utility for conditional classes.
- **Icons**: Lucide-React is the standard icon library.
- **Latex**: Use `LatexText` for mathematical or scientific notation.
- **State Management**: Local `useState` and `useCallback` preferred. Encapsulate complex logic in custom hooks (e.g., `useQuizKeyboard`).
- **Error Handling**: Wrap complex components like `AuditWorkstation` in `ErrorBoundary`.
- **Loading States**: Use `Skeleton` components for consistent layout during data fetching.
- **Accessibility**: Support keyboard navigation in interactive components.

## ANTI-PATTERNS
- **Monolith Bloat**: Do not add logic to `AuditWorkstation.tsx`. Extract features into sub-components or hooks in `audit/`.
- **Prop Drilling**: Use context or composition for deeply nested state.
- **Direct DOM Manipulation**: Use React refs or state instead of `document` or `window` access.
- **Inline Styles**: Avoid `style` prop unless for dynamic values Tailwind cannot handle.
- **Hardcoded Strings**: Use `i18n` patterns for user-facing text.
- **Complex Handlers**: Keep event handlers small. Extract logic if a handler exceeds 50 lines.
