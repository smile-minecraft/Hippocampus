/**
 * lib/logger.ts
 * Unified structured logger for Hippocampus.
 *
 * Server-side:
 *   Emits newline-delimited JSON (NDJSON) to stdout/stderr for structured
 *   log aggregation (compatible with Cloud Run, Datadog, etc.).
 *
 * Worker TUI mode:
 *   When a TUI sink is registered via `setLogSink()`, log entries are pushed
 *   to the sink callback instead of writing to stdout/stderr.  This prevents
 *   NDJSON from corrupting the ink-rendered TUI.
 *
 * Client-side:
 *   Falls back to console.* with a `[service]` prefix. Can be extended later
 *   to forward to a remote error-tracking service (Sentry, LogRocket, etc.).
 *
 * Usage:
 *   import { log } from '@/lib/logger'
 *
 *   log.info('parser-worker', 'Job started', { jobId: '123' })
 *   log.error('auth', 'Token verification failed', { userId: 'abc' })
 *   log.warn('rate-limit', 'Redis error, failing open', { ip: '1.2.3.4' })
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
    level: LogLevel
    service: string
    message: string
    timestamp: string
    [key: string]: unknown
}

export type LogSinkFn = (entry: { level: LogLevel; service: string; message: string; timestamp: string; meta?: Record<string, unknown> }) => void

let _sink: LogSinkFn | null = null

/**
 * Register a sink that intercepts ALL log output.
 * When set, stdout/stderr NDJSON is suppressed — the sink owns output.
 * Pass `null` to restore default NDJSON behaviour.
 */
export function setLogSink(sink: LogSinkFn | null): void {
    _sink = sink
}

const isServer = typeof window === 'undefined'

function emit(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()

    // If a TUI sink is registered, delegate entirely to it
    if (_sink) {
        _sink({ level, service, message, timestamp, meta })
        return
    }

    const entry: LogEntry = {
        level,
        service,
        message,
        timestamp,
        ...meta,
    }

    if (isServer) {
        const json = JSON.stringify(entry)
        if (level === 'error') {
            process.stderr.write(json + '\n')
        } else {
            process.stdout.write(json + '\n')
        }
    } else {
        // Client-side: structured console output
        // eslint-disable-next-line no-console -- logger is the sole approved console wrapper
        const write = { error: console.error, warn: console.warn, info: console.info, debug: console.debug }[level]
        const prefix = `[${service}]`
        const extra = meta && Object.keys(meta).length > 0 ? meta : undefined
        if (extra) {
            write(prefix, message, extra)
        } else {
            write(prefix, message)
        }
    }
}

export const log = {
    debug: (service: string, message: string, meta?: Record<string, unknown>) => emit('debug', service, message, meta),
    info:  (service: string, message: string, meta?: Record<string, unknown>) => emit('info', service, message, meta),
    warn:  (service: string, message: string, meta?: Record<string, unknown>) => emit('warn', service, message, meta),
    error: (service: string, message: string, meta?: Record<string, unknown>) => emit('error', service, message, meta),
}
