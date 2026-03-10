/**
 * lib/logger.ts
 * Unified structured logger for Hippocampus.
 *
 * Server-side:
 *   Emits newline-delimited JSON (NDJSON) to stdout/stderr for structured
 *   log aggregation (compatible with Cloud Run, Datadog, etc.).
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

const isServer = typeof window === 'undefined'

function emit(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
        level,
        service,
        message,
        timestamp: new Date().toISOString(),
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
