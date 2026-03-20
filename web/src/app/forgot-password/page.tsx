'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { AuthPanel } from '@/components/ui/AuthPanel'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

export default function ForgotPasswordPage() {
    const emailId = useId()
    const messageId = useId()
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        setLoading(true)
        setError(null)
        setSuccess(false)

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            })

            const text = await response.text()
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(text)
            } catch {
                data = {}
            }

            if (!response.ok || !data.ok) {
                throw new Error((data.message as string) || (data.error as string) || '發送失敗，請稍後再試')
            }

            setSuccess(true)
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : '發送失敗')
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthPanel
            eyebrow="Password recovery"
            title="申請重設密碼"
            description="輸入你的註冊信箱，我們會寄出新的重設連結。"
            footer={(
                <p className="text-sm leading-7 text-text-muted">
                    想起來了？{' '}
                    <Link href="/login" className="font-semibold text-primary-base transition-colors hover:text-primary-hover">
                        回到登入
                    </Link>
                </p>
            )}
        >
            {success ? (
                <div className="notice notice-success space-y-2" role="status" aria-live="polite">
                    <p className="text-sm font-semibold text-text-base">重設連結已發送</p>
                    <p className="text-sm leading-7 text-text-muted">
                        請檢查你的電子郵件信箱。如果幾分鐘內沒有收到，請一併查看垃圾郵件匣。
                    </p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                    {error ? (
                        <div id={messageId} className="notice notice-error" role="alert">
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
                                aria-describedby={error ? messageId : undefined}
                                required
                            />
                        </div>
                    </Field>
                    <Button type="submit" size="lg" className="w-full" isLoading={loading}>
                        {!loading ? '寄送重設連結' : null}
                    </Button>
                </form>
            )}
        </AuthPanel>
    )
}
