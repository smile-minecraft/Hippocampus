'use client'

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/lib/cn'

type NoticeTone = 'info' | 'success' | 'warning' | 'error'
type ConfirmTone = 'default' | 'danger'

interface Notice {
    id: string
    tone: NoticeTone
    title: string
    description?: string
}

interface ConfirmState {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: ConfirmTone
}

interface ConfirmOptions extends ConfirmState {}

interface NotifyOptions {
    tone?: NoticeTone
    title: string
    description?: string
}

interface FeedbackContextValue {
    confirm: (options: ConfirmOptions | string) => Promise<boolean>
    notify: (options: NotifyOptions | string) => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
    const [notices, setNotices] = useState<Notice[]>([])
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
    const confirmResolverRef = useRef<((value: boolean) => void) | null>(null)

    const notify = useCallback((options: NotifyOptions | string) => {
        const payload = typeof options === 'string'
            ? { tone: 'info' as const, title: options }
            : { tone: 'info' as const, ...options }

        const notice: Notice = {
            id: crypto.randomUUID(),
            tone: payload.tone,
            title: payload.title,
            description: payload.description,
        }

        setNotices((prev) => [...prev, notice])
    }, [])

    const dismissNotice = useCallback((id: string) => {
        setNotices((prev) => prev.filter((notice) => notice.id !== id))
    }, [])

    useEffect(() => {
        if (notices.length === 0) return

        const timers = notices.map((notice) =>
            window.setTimeout(() => dismissNotice(notice.id), notice.tone === 'error' ? 6000 : 4200),
        )

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer))
        }
    }, [dismissNotice, notices])

    const closeConfirm = useCallback((accepted: boolean) => {
        setConfirmState(null)
        confirmResolverRef.current?.(accepted)
        confirmResolverRef.current = null
    }, [])

    const confirm = useCallback((options: ConfirmOptions | string) => {
        const payload = typeof options === 'string'
            ? { title: options }
            : options

        setConfirmState({
            cancelLabel: '取消',
            confirmLabel: '確認',
            tone: 'default',
            ...payload,
        })

        return new Promise<boolean>((resolve) => {
            confirmResolverRef.current = resolve
        })
    }, [])

    const value = useMemo<FeedbackContextValue>(() => ({
        confirm,
        notify,
    }), [confirm, notify])

    return (
        <FeedbackContext.Provider value={value}>
            {children}
            <ToastRegion notices={notices} onDismiss={dismissNotice} />
            <ConfirmDialog state={confirmState} onClose={closeConfirm} />
        </FeedbackContext.Provider>
    )
}

export function useFeedback(): FeedbackContextValue {
    const context = useContext(FeedbackContext)
    if (!context) {
        throw new Error('useFeedback must be used within FeedbackProvider')
    }
    return context
}

function ToastRegion({
    notices,
    onDismiss,
}: {
    notices: Notice[]
    onDismiss: (id: string) => void
}) {
    return (
        <div
            aria-live="polite"
            aria-atomic="true"
            className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3"
        >
            {notices.map((notice) => (
                <div
                    key={notice.id}
                    className={cn(
                        'notice pointer-events-auto flex items-start gap-3 px-4 py-3',
                        notice.tone === 'success' && 'notice-success',
                        notice.tone === 'warning' && 'notice-warning',
                        notice.tone === 'error' && 'notice-error',
                        notice.tone === 'info' && 'notice-info',
                    )}
                >
                    <span className="mt-0.5 text-primary-base" aria-hidden>
                        <NoticeIcon tone={notice.tone} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text-base">{notice.title}</p>
                        {notice.description ? (
                            <p className="mt-1 text-sm leading-6 text-text-muted">{notice.description}</p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        aria-label="關閉提示"
                        onClick={() => onDismiss(notice.id)}
                        className="rounded-full p-1 text-text-subtle transition-colors hover:bg-bg-surface hover:text-text-base"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            ))}
        </div>
    )
}

function ConfirmDialog({
    state,
    onClose,
}: {
    state: ConfirmState | null
    onClose: (accepted: boolean) => void
}) {
    const confirmButtonRef = useRef<HTMLButtonElement>(null)
    const lastFocusedRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!state) return

        lastFocusedRef.current = document.activeElement as HTMLElement | null
        confirmButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                onClose(false)
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            lastFocusedRef.current?.focus()
        }
    }, [onClose, state])

    if (!state) return null

    return (
        <div className="dialog-overlay fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby={state.description ? 'confirm-dialog-description' : undefined}
                className="dialog-panel w-full max-w-lg p-6"
            >
                <div className="flex items-start gap-4">
                    <div className={cn(
                        'flex size-12 items-center justify-center rounded-2xl',
                        state.tone === 'danger' ? 'bg-danger-muted text-danger-base' : 'bg-primary-muted text-primary-base',
                    )}>
                        {state.tone === 'danger' ? <AlertTriangle className="size-5" /> : <TriangleAlert className="size-5" />}
                    </div>
                    <div className="flex-1 space-y-2">
                        <h2 id="confirm-dialog-title" className="font-heading text-xl font-semibold text-text-base">
                            {state.title}
                        </h2>
                        {state.description ? (
                            <p id="confirm-dialog-description" className="text-sm leading-7 text-text-muted">
                                {state.description}
                            </p>
                        ) : null}
                    </div>
                </div>
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={() => onClose(false)}>
                        {state.cancelLabel}
                    </Button>
                    <Button
                        ref={confirmButtonRef}
                        type="button"
                        variant={state.tone === 'danger' ? 'danger' : 'primary'}
                        onClick={() => onClose(true)}
                    >
                        {state.confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    )
}

function NoticeIcon({ tone }: { tone: NoticeTone }) {
    if (tone === 'success') return <CheckCircle2 className="size-4" />
    if (tone === 'warning') return <TriangleAlert className="size-4" />
    if (tone === 'error') return <AlertTriangle className="size-4" />
    return <Info className="size-4" />
}
