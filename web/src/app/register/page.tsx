'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, Mail, User } from 'lucide-react'
import { AuthPanel } from '@/components/ui/AuthPanel'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

export default function RegisterPage() {
    const router = useRouter()
    const nameId = useId()
    const emailId = useId()
    const passwordId = useId()
    const confirmId = useId()
    const errorId = useId()

    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        setLoading(true)
        setError(null)
        setFieldErrors({})

        if (password !== confirmPassword) {
            setError('密碼與確認密碼不一致')
            setLoading(false)
            return
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name: name || undefined }),
            })

            const text = await response.text()
            let data: Record<string, unknown> = {}

            try {
                data = JSON.parse(text)
            } catch {
                throw new Error('伺服器回應格式錯誤')
            }

            if (!response.ok || !data.ok) {
                if (data.fields) {
                    setFieldErrors(data.fields as Record<string, string>)
                }
                throw new Error((data.message as string) || '註冊失敗，請檢查填寫資料')
            }

            router.replace('/')
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : '註冊失敗')
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthPanel
            eyebrow="Create account"
            title="建立新工作區帳號"
            description="註冊後會自動登入，並直接帶你進入新版 Notion 式工作區。"
            footer={(
                <p className="text-sm leading-7 text-text-muted">
                    已有帳號？{' '}
                    <Link href="/login" className="font-semibold text-primary-base transition-colors hover:text-primary-hover">
                        直接登入
                    </Link>
                </p>
            )}
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {error ? (
                    <div id={errorId} className="notice notice-error" role="alert" aria-live="polite">
                        <p className="text-sm font-medium text-text-base">{error}</p>
                    </div>
                ) : null}

                <Field label="姓名" htmlFor={nameId} hint="可先留白，之後可在個人資料中補上。">
                    <div className="relative">
                        <User className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                        <input
                            id={nameId}
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="input pl-11"
                            placeholder="你的顯示名稱"
                            aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
                        />
                    </div>
                </Field>
                {fieldErrors.name ? <p id={`${nameId}-error`} className="text-xs text-danger-base">{fieldErrors.name}</p> : null}

                <Field label="電子郵件" htmlFor={emailId} required error={fieldErrors.email}>
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
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={fieldErrors.email ? `${emailId}-error` : error ? errorId : undefined}
                            required
                        />
                    </div>
                </Field>

                <Field label="密碼" htmlFor={passwordId} required hint="至少 8 個字元，並包含一個大寫字母與數字。" error={fieldErrors.password}>
                    <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                        <input
                            id={passwordId}
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="input pl-11"
                            placeholder="設定一組新密碼"
                            aria-invalid={Boolean(fieldErrors.password)}
                            aria-describedby={fieldErrors.password ? `${passwordId}-error` : error ? errorId : undefined}
                            required
                        />
                    </div>
                </Field>

                <Field label="確認密碼" htmlFor={confirmId} required>
                    <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                        <input
                            id={confirmId}
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            className="input pl-11"
                            placeholder="再次輸入密碼"
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? errorId : undefined}
                            required
                        />
                    </div>
                </Field>

                <Button type="submit" size="lg" className="w-full" isLoading={loading}>
                    {!loading ? '建立帳號' : null}
                </Button>
            </form>
        </AuthPanel>
    )
}
