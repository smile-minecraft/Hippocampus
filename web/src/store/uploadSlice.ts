import { StateCreator } from 'zustand'
import { ParserJobStatusPayload } from '@/app/api/parser/status/[jobId]/route'

export interface JobState {
    id: string
    fileName: string
    fileSizeMB: string
    jobId: string | null
    status: ParserJobStatusPayload | null
    error: string | null
    uploading: boolean
}

export interface UploadSlice {
    jobs: JobState[]
    addJob: (job: JobState) => void
    updateJob: (id: string, partial: Partial<JobState>) => void
    removeJob: (id: string) => void
    clearCompletedJobs: () => void
}

export const createUploadSlice: StateCreator<UploadSlice, [], [], UploadSlice> = (set) => ({
    jobs: [],
    addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
    updateJob: (id, partial) =>
        set((state) => ({
            jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...partial } : j)),
        })),
    removeJob: (id) =>
        set((state) => ({
            jobs: state.jobs.filter((j) => j.id !== id),
        })),
    clearCompletedJobs: () =>
        set((state) => ({
            jobs: state.jobs.filter(
                (j) => j.status?.state !== 'completed' && j.status?.state !== 'failed' && !j.error
            ),
        })),
})
