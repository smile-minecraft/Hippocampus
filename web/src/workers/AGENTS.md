# WORKERS KNOWLEDGE BASE

## OVERVIEW
BullMQ worker domain with integrated Terminal UI (TUI) for real-time monitoring.

## WHERE TO LOOK
- `parser.worker.ts`: Document parsing pipeline (PDF/Word to Markdown).
- `explanation.worker.ts`: AI-driven explanation generation.
- `tui/`: React-based Terminal UI components using Ink.
- `tui/store.ts`: Reactive state for worker progress and logs.
- `tui/LogPanel.tsx`: Real-time log streaming component.

## CONVENTIONS
- **Progress**: Use `reportProgress` helper for BullMQ and TUI synchronization.
- **Cleanup**: Use `finally` blocks for `/tmp` directory removal.
- **Shutdown**: Register subprocesses in `activeSubprocesses` for SIGTERM cleanup.
- **Logging**: Route all worker logs through `appendLog` to the TUI store.

## ANTI-PATTERNS
- **Desync**: Updating BullMQ progress without mirroring to the TUI store.
- **Main Thread CPU**: Running `pdftoppm` or heavy parsing without `spawn`.
- **Orphaned Files**: Leaving `/tmp/parser-{jobId}` directories after completion.
- **Silent Retries**: Failing to log Cockatiel retry attempts to the TUI.
