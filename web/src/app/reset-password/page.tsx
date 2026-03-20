'use client'

import { Suspense, useId, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { AuthPanel } from '@/components/ui/AuthPanel'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

function ResetPasswordForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get('token')
    const passwordId = useId()
    const confirmId = useId()
    const messageId = useId()

    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    if (!token) {
        return (
            <div className="notice notice-error space-y-3" role="alert">
                <p className="text-sm font-semibold text-text-base">無效的重設連結</p>
                <p className="text-sm leading-7 text-text-muted">此連結可能已過期，請重新申請新的重設信件。</p>
                <Link href="/forgot-password" className="text-sm font-semibold text-primary-base transition-colors hover:text-primary-hover">
                    重新申請
                </Link>
            </div>
        )
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        setLoading(true)
        setError(null)

        if (password !== confirmPassword) {
            setError('兩次輸入的密碼不一致')
            setLoading(false)
            return
        }

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            })

            const text = await response.text()
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(text)
            } catch {
                data = {}
            }

            if (!response.ok || !data.ok) {
                throw new Error((data.message as string) || (data.error as string) || '重設失敗，連結可能已過期')
            }

            setSuccess(true)
            window.setTimeout(() => {
                router.replace('/login')
            }, 1600)
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : '重設失敗')
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="notice notice-success space-y-3" role="status" aria-live="polite">
                <p className="text-sm font-semibold text-text-base">密碼已更新</p>
                <p className="text-sm leading-7 text-text-muted">系統會帶你回登入頁，也可以直接使用新密碼重新登入。</p>
                <Link href="/login" className="text-sm font-semibold text-primary-base transition-colors hover:text-primary-hover">
                    立即登入
                </Link>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error ? (
                <div id={messageId} className="notice notice-error" role="alert">
                    <p className="text-sm font-medium text-text-base">{error}</p>
                </div>
            ) : null}
            <Field label="新密碼" htmlFor={passwordId} required hint="至少 8 個字元。">
                <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                    <input
                        id={passwordId}
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input pl-11"
                        placeholder="輸入新的密碼"
                        minLength={8}
                        autoComplete="new-password"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? messageId : `${passwordId}-hint`}
                        required
                    />
                </div>
            </Field>
            <Field label="確認新密碼" htmlFor={confirmId} required>
                <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                    <input
                        id={confirmId}
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="input pl-11"
                        placeholder="再次輸入密碼"
                        minLength={8}
                        autoComplete="new-password"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? messageId : undefined}
                        required
                    />
                </div>
            </Field>
            <Button type="submit" size="lg" className="w-full" isLoading={loading}>
                {!loading ? '確認重設' : null}
            </Button>
        </form>
    )
}

export default function ResetPasswordPage() {
    return (
        <AuthPanel
            eyebrow="Reset password"
            title="設定新的密碼"
            description="這個表單只接受有效的重設 token。完成後會自動帶你回登入頁。"
            footer={(
                <p className="text-sm leading-7 text-text-muted">
                    返回{' '}
                    <Link href="/login" className="font-semibold text-primary-base transition-colors hover:text-primary-hover">
                        登入頁
                    </Link>
                </p>
            )}
        >
            <Suspense
                fallback={(
                    <div className="flex items-center justify-center rounded-2xl border border-border-base bg-surface-base px-4 py-8">
                        <Loader2 className="size-5 animate-spin text-primary-base" />
                    </div>
                )}
            >
                <ResetPasswordForm />
            </Suspense>
        </AuthPanel>
    )
}
