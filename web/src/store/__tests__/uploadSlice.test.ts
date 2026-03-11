import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the ParserJobStatusPayload import from the API route.
// The uploadSlice only uses the type, but the module import may trigger
// side-effects, so we mock it to isolate the test.
// ---------------------------------------------------------------------------

vi.mock('@/app/api/parser/status/[jobId]/route', () => ({}))

import { createUploadSlice, type JobState, type UploadSlice } from '../uploadSlice'
import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Helper — create a standalone store from the slice creator
// ---------------------------------------------------------------------------

function createStore() {
    return create<UploadSlice>()((...a) => createUploadSlice(...a))
}

function makeJob(overrides: Partial<JobState> = {}): JobState {
    return {
        id: crypto.randomUUID(),
        fileName: 'test.pdf',
        fileSizeMB: '2.5',
        jobId: null,
        status: null,
        error: null,
        uploading: true,
        ...overrides,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('uploadSlice', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        store = createStore()
    })

    // ─── addJob ────────────────────────────────────────────────────────

    describe('addJob', () => {
        it('prepends a job to the list', () => {
            const job = makeJob({ id: 'a' })
            store.getState().addJob(job)
            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].id).toBe('a')
        })

        it('prepends newer jobs to the front', () => {
            store.getState().addJob(makeJob({ id: 'first' }))
            store.getState().addJob(makeJob({ id: 'second' }))
            expect(store.getState().jobs[0].id).toBe('second')
            expect(store.getState().jobs[1].id).toBe('first')
        })
    })

    // ─── updateJob ─────────────────────────────────────────────────────

    describe('updateJob', () => {
        it('updates fields on the matching job', () => {
            store.getState().addJob(makeJob({ id: 'target' }))
            store.getState().updateJob('target', { uploading: false, jobId: 'bull-123' })

            const job = store.getState().jobs.find((j) => j.id === 'target')!
            expect(job.uploading).toBe(false)
            expect(job.jobId).toBe('bull-123')
        })

        it('does not affect other jobs', () => {
            store.getState().addJob(makeJob({ id: 'a', fileName: 'a.pdf' }))
            store.getState().addJob(makeJob({ id: 'b', fileName: 'b.pdf' }))
            store.getState().updateJob('a', { fileName: 'updated.pdf' })

            expect(store.getState().jobs.find((j) => j.id === 'b')!.fileName).toBe('b.pdf')
        })

        it('no-ops when id does not match', () => {
            store.getState().addJob(makeJob({ id: 'exists' }))
            store.getState().updateJob('nonexistent', { uploading: false })

            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].uploading).toBe(true)
        })
    })

    // ─── removeJob ─────────────────────────────────────────────────────

    describe('removeJob', () => {
        it('removes the job with the given id', () => {
            store.getState().addJob(makeJob({ id: 'a' }))
            store.getState().addJob(makeJob({ id: 'b' }))
            store.getState().removeJob('a')

            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].id).toBe('b')
        })

        it('no-ops when id does not exist', () => {
            store.getState().addJob(makeJob({ id: 'a' }))
            store.getState().removeJob('nonexistent')
            expect(store.getState().jobs).toHaveLength(1)
        })
    })

    // ─── clearCompletedJobs ────────────────────────────────────────────

    describe('clearCompletedJobs', () => {
        it('removes jobs with status.state = "completed"', () => {
            store.getState().addJob(makeJob({ id: 'done', status: { jobId: '1', state: 'completed', progress: 100 } }))
            store.getState().addJob(makeJob({ id: 'active', status: { jobId: '2', state: 'active', progress: 50 } }))
            store.getState().clearCompletedJobs()

            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].id).toBe('active')
        })

        it('removes jobs with status.state = "failed"', () => {
            store.getState().addJob(makeJob({ id: 'failed', status: { jobId: '1', state: 'failed', progress: 0 } }))
            store.getState().addJob(makeJob({ id: 'active', status: null }))
            store.getState().clearCompletedJobs()

            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].id).toBe('active')
        })

        it('removes jobs with an error string', () => {
            store.getState().addJob(makeJob({ id: 'errored', error: 'Upload failed' }))
            store.getState().addJob(makeJob({ id: 'ok', error: null }))
            store.getState().clearCompletedJobs()

            expect(store.getState().jobs).toHaveLength(1)
            expect(store.getState().jobs[0].id).toBe('ok')
        })

        it('keeps jobs that are still active with no error', () => {
            store.getState().addJob(makeJob({ id: 'pending', status: null, error: null }))
            store.getState().addJob(makeJob({ id: 'working', status: { jobId: '1', state: 'active', progress: 30 }, error: null }))
            store.getState().clearCompletedJobs()

            expect(store.getState().jobs).toHaveLength(2)
        })

        it('handles empty job list', () => {
            store.getState().clearCompletedJobs()
            expect(store.getState().jobs).toHaveLength(0)
        })
    })
})
