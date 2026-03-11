/**
 * tui/store.ts — Vanilla (non-React) store for the worker TUI.
 *
 * Uses zustand/vanilla so it can be written to from anywhere (logger, worker
 * events, reportProgress) without importing React.  Ink components consume
 * it via `useStore(tuiStore)`.
 */

import { createStore } from "zustand/vanilla";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobState {
    id: string;
    shortId: string;
    filename: string;
    percent: number;
    message: string;
    startedAt: number;
}

export interface QueueCounts {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    service: string;
    message: string;
    meta?: Record<string, unknown>;
}

export interface TuiState {
    // Worker metadata
    workerStartedAt: number;
    concurrency: number;
    provider: string;

    // Active jobs (keyed by jobId)
    jobs: Record<string, JobState>;

    // Queue statistics
    queueCounts: QueueCounts;

    // Scrolling log buffer (ring buffer — keeps last MAX_LOGS entries)
    logs: LogEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOGS = 200;

// ---------------------------------------------------------------------------
// Store singleton
// ---------------------------------------------------------------------------

export const tuiStore = createStore<TuiState>(() => ({
    workerStartedAt: Date.now(),
    concurrency: 0,
    provider: "openai",

    jobs: {},
    queueCounts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    logs: [],
}));

// ---------------------------------------------------------------------------
// Mutation helpers (called from worker code, logger, etc.)
// ---------------------------------------------------------------------------

export function upsertJob(jobId: string, update: Partial<JobState>): void {
    tuiStore.setState((s) => {
        const existing = s.jobs[jobId];
        const job: JobState = existing
            ? { ...existing, ...update }
            : {
                  id: jobId,
                  shortId: jobId.slice(0, 8),
                  filename: "",
                  percent: 0,
                  message: "",
                  startedAt: Date.now(),
                  ...update,
              };
        return { jobs: { ...s.jobs, [jobId]: job } };
    });
}

export function removeJob(jobId: string): void {
    tuiStore.setState((s) => {
        const { [jobId]: _, ...rest } = s.jobs;
        return { jobs: rest };
    });
}

export function setQueueCounts(counts: QueueCounts): void {
    tuiStore.setState({ queueCounts: counts });
}

export function appendLog(entry: LogEntry): void {
    tuiStore.setState((s) => {
        const next = [...s.logs, entry];
        // Trim to ring buffer size
        return { logs: next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next };
    });
}

export function setWorkerMeta(meta: { concurrency?: number; provider?: string }): void {
    tuiStore.setState((s) => ({
        concurrency: meta.concurrency ?? s.concurrency,
        provider: meta.provider ?? s.provider,
    }));
}
