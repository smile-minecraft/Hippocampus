import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { log } from '../logger'

describe('Unified logger', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>
    let stderrSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    // ---------- Structure ----------

    it('emits NDJSON with required fields on server', () => {
        log.info('test-service', 'hello world')

        expect(stdoutSpy).toHaveBeenCalledOnce()
        const raw = stdoutSpy.mock.calls[0][0] as string
        expect(raw.endsWith('\n')).toBe(true)

        const entry = JSON.parse(raw)
        expect(entry).toMatchObject({
            level: 'info',
            service: 'test-service',
            message: 'hello world',
        })
        expect(entry.timestamp).toBeDefined()
        // ISO 8601 check
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
    })

    it('includes arbitrary meta fields in the JSON output', () => {
        log.warn('auth', 'Token expired', { userId: 'abc', ttl: 0 })

        const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
        expect(entry.userId).toBe('abc')
        expect(entry.ttl).toBe(0)
        expect(entry.level).toBe('warn')
    })

    // ---------- Levels ----------

    it('routes debug/info/warn to stdout', () => {
        log.debug('d', 'debug msg')
        log.info('i', 'info msg')
        log.warn('w', 'warn msg')

        expect(stdoutSpy).toHaveBeenCalledTimes(3)
        expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('routes error to stderr', () => {
        log.error('e', 'error msg')

        expect(stderrSpy).toHaveBeenCalledOnce()
        expect(stdoutSpy).not.toHaveBeenCalled()

        const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
        expect(entry.level).toBe('error')
    })

    // ---------- Edge cases ----------

    it('handles empty meta gracefully', () => {
        log.info('svc', 'no meta')

        const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
        // Should only have the base fields
        expect(Object.keys(entry).sort()).toEqual(
            ['level', 'message', 'service', 'timestamp'].sort(),
        )
    })

    it('handles meta with special characters in values', () => {
        log.info('svc', 'special', { path: '/foo?bar=baz&x=1', emoji: '🔥' })

        const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
        expect(entry.path).toBe('/foo?bar=baz&x=1')
        expect(entry.emoji).toBe('🔥')
    })
})
