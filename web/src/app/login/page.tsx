'use client'

import { Suspense, useId, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Lock, Mail } from 'lucide-react'
import { AuthPanel } from '@/components/ui/AuthPanel'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { sanitizeInternalPath } from '@/lib/navigation'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const redirect = sanitizeInternalPath(searchParams.get('redirect'), '/')
    const emailId = useId()
    const passwordId = useId()
    const errorId = useId()

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })

            const text = await response.text()
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(text)
            } catch {
                data = {}
            }

            if (!response.ok || !data.ok) {
                throw new Error(
                    (data.message as string) ||
                    (data.error as string) ||
                    '登入失敗，請檢查帳號密碼',
                )
            }

            router.replace(redirect)
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : '登入失敗')
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error ? (
                <div id={errorId} className="notice notice-error" role="alert" aria-live="polite">
                    <p className="text-sm font-medium text-text-base">{error}</p>
                </div>
            ) : null}

            <Field label="電子郵件" htmlFor={emailId} required>
                <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                    <input
                        id={emailId}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input pl-11"
                        placeholder="name@example.com"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                        required
                    />
                </div>
            </Field>

            <Field label="密碼" htmlFor={passwordId} required>
                <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                    <input
                        id={passwordId}
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input pl-11"
                        placeholder="輸入您的密碼"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                        required
                    />
                </div>
            </Field>

            <div className="flex items-center justify-between text-sm">
                <span className="text-text-subtle">登入後會保留目前工作進度與偏好設定。</span>
                <Link href="/forgot-password" className="font-medium text-primary-base transition-colors hover:text-primary-hover">
                    忘記密碼？
                </Link>
            </div>

            <Button type="submit" size="lg" className="w-full" isLoading={loading}>
                {!loading ? '登入工作區' : null}
            </Button>
        </form>
    )
}

export default function LoginPage() {
    return (
        <AuthPanel
            eyebrow="Authentication"
            title="登入 Hippocampus"
            description="進入你的刷題、知識共筆與審核工作區。"
            footer={(
                <p className="text-sm leading-7 text-text-muted">
                    沒有帳號？{' '}
                    <Link href="/register" className="font-semibold text-primary-base transition-colors hover:text-primary-hover">
                        建立新帳號
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
                <LoginForm />
            </Suspense>
        </AuthPanel>
    )
}
