'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Lock, Mail, User, Loader2, Check, AlertCircle } from 'lucide-react'

/**
 * Registration page — Client Component.
 * Outside (main) route group (no TopNav), consistent with /login.
 * Calls POST /api/auth/register, which auto-logs in on success.
 */
export default function RegisterPage() {
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setFieldErrors({})

        // Client-side validation
        if (password !== confirmPassword) {
            setError('密碼與確認密碼不一致')
            setLoading(false)
            return
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name: name || undefined }),
            })
            const text = await res.text()
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(text)
            } catch {
                throw new Error('伺服器回應格式錯誤')
            }

            if (!res.ok || !data.ok) {
                if (data.fields) {
                    setFieldErrors(data.fields as Record<string, string>)
                }
                throw new Error(
                    (data.message as string) || '註冊失敗，請檢查填寫資料'
                )
            }

            setSuccess(true)
            // Redirect to home after short delay
            setTimeout(() => {
                window.location.href = '/'
            }, 1000)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '註冊失敗')
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-screen bg-bg-base flex justify-center items-center p-4">
                <div className="max-w-md w-full bg-bg-surface p-8 rounded-2xl border border-border-base shadow-2xl text-center space-y-4">
                    <Check className="size-12 text-green-400 mx-auto" />
                    <h2 className="text-xl font-bold text-text-base">註冊成功</h2>
                    <p className="text-text-muted text-sm">正在導向首頁...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-bg-base flex justify-center items-center p-4">
            <div className="max-w-md w-full bg-bg-surface p-8 rounded-2xl border border-border-base shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-teal-400 to-cyan-500" />

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-500 mb-2">
                        建立帳號
                    </h1>
                    <p className="text-text-muted text-sm">加入 Hippocampus 醫學知識庫</p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm font-medium flex items-center gap-2">
                        <AlertCircle className="size-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Name */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-muted ml-1">
                            姓名 <span className="text-text-muted/60">（選填）</span>
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                            <input
                                type="text"
                                className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="您的姓名"
                            />
                        </div>
                        {fieldErrors.name && (
                            <p className="text-xs text-red-400 ml-1">{fieldErrors.name}</p>
                        )}
                    </div>

                    {/* Email */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-muted ml-1">電子郵件</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                            <input
                                type="email"
                                className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                required
                            />
                        </div>
                        {fieldErrors.email && (
                            <p className="text-xs text-red-400 ml-1">{fieldErrors.email}</p>
                        )}
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-muted ml-1">密碼</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                            <input
                                type="password"
                                className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="至少 8 字元，含大寫字母與數字"
                                required
                            />
                        </div>
                        {fieldErrors.password && (
                            <p className="text-xs text-red-400 ml-1">{fieldErrors.password}</p>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-muted ml-1">確認密碼</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                            <input
                                type="password"
                                className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="再次輸入密碼"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-teal-900/20 flex justify-center items-center mt-4 disabled:opacity-70"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '建立帳號'}
                    </button>

                    <p className="text-sm text-text-muted text-center mt-4">
                        已有帳號？{' '}
                        <Link href="/login" className="text-teal-400 hover:underline font-medium">
                            登入
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    )
}
