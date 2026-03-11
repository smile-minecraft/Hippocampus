'use client'

import { useState, useEffect, useCallback } from 'react'
import { User, Lock, Mail, Calendar, BarChart3, Loader2, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

interface UserProfile {
    id: string
    email: string
    name: string | null
    role: string
    createdAt: string
    _count: { questionRecords: number }
}

/**
 * Profile page — Client Component.
 * Shows user info + stats, with password change form.
 */
export default function ProfilePage() {
    const [user, setUser] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Password change state
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [pwLoading, setPwLoading] = useState(false)
    const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    // Name edit state
    const [editingName, setEditingName] = useState(false)
    const [nameValue, setNameValue] = useState('')
    const [nameLoading, setNameLoading] = useState(false)

    useEffect(() => {
        async function loadProfile() {
            try {
                const res = await fetch('/api/users/me', { credentials: 'include' })
                if (!res.ok) throw new Error('無法載入個人資料')
                const json = await res.json()
                if (json.ok) {
                    setUser(json.data)
                    setNameValue(json.data.name ?? '')
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : '載入失敗')
            } finally {
                setLoading(false)
            }
        }
        loadProfile()
    }, [])

    const getCsrfToken = useCallback(() => {
        const match = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
        return match ? match[1] : ''
    }, [])

    const handleNameSave = useCallback(async () => {
        if (!nameValue.trim()) return
        setNameLoading(true)
        try {
            const res = await fetch('/api/users/me', {
                method: 'PATCH',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken(),
                },
                body: JSON.stringify({ name: nameValue.trim() }),
            })
            const json = await res.json()
            if (json.ok) {
                setUser(prev => prev ? { ...prev, name: nameValue.trim() } : prev)
                setEditingName(false)
            }
        } catch {
            // Silent fail
        } finally {
            setNameLoading(false)
        }
    }, [nameValue, getCsrfToken])

    const handlePasswordChange = useCallback(async (e: React.FormEvent) => {
        e.preventDefault()
        setPwMessage(null)

        if (newPassword !== confirmPassword) {
            setPwMessage({ type: 'error', text: '新密碼與確認密碼不一致' })
            return
        }
        if (newPassword.length < 8) {
            setPwMessage({ type: 'error', text: '新密碼長度至少 8 個字元' })
            return
        }
        if (!/[A-Z]/.test(newPassword)) {
            setPwMessage({ type: 'error', text: '新密碼必須包含至少一個大寫字母' })
            return
        }
        if (!/[0-9]/.test(newPassword)) {
            setPwMessage({ type: 'error', text: '新密碼必須包含至少一個數字' })
            return
        }

        setPwLoading(true)
        try {
            const res = await fetch('/api/users/me/password', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken(),
                },
                body: JSON.stringify({ currentPassword, newPassword }),
            })
            const json = await res.json()
            if (json.ok) {
                setPwMessage({ type: 'success', text: '密碼修改成功' })
                setCurrentPassword('')
                setNewPassword('')
                setConfirmPassword('')
            } else {
                setPwMessage({ type: 'error', text: json.message || '密碼修改失敗' })
            }
        } catch {
            setPwMessage({ type: 'error', text: '密碼修改失敗，請稍後再試' })
        } finally {
            setPwLoading(false)
        }
    }, [currentPassword, newPassword, confirmPassword, getCsrfToken])

    if (loading) {
        return (
            <main className="min-h-screen bg-bg-base flex items-center justify-center">
                <Loader2 className="size-8 animate-spin text-text-muted" />
            </main>
        )
    }

    if (error || !user) {
        return (
            <main className="min-h-screen bg-bg-base px-4 py-16">
                <div className="max-w-md mx-auto text-center space-y-4">
                    <AlertCircle className="size-12 text-red-400 mx-auto" />
                    <p className="text-text-muted">{error || '請先登入'}</p>
                </div>
            </main>
        )
    }

    return (
        <main className="min-h-screen bg-bg-base px-4 py-8 md:py-12">
            <div className="max-w-2xl mx-auto space-y-8">
                {/* Header */}
                <header className="space-y-2">
                    <h1 className="text-3xl font-heading font-bold text-text-base tracking-tight flex items-center gap-3">
                        <User className="size-8 text-primary-base" />
                        個人資料
                    </h1>
                </header>

                {/* User Info Card */}
                <div className="card p-6 space-y-5">
                    {/* Email */}
                    <div className="flex items-center gap-3">
                        <Mail className="size-5 text-text-muted" />
                        <div>
                            <p className="text-xs text-text-muted">電子郵件</p>
                            <p className="text-text-base font-medium">{user.email}</p>
                        </div>
                    </div>

                    {/* Name */}
                    <div className="flex items-center gap-3">
                        <User className="size-5 text-text-muted" />
                        <div className="flex-1">
                            <p className="text-xs text-text-muted">姓名</p>
                            {editingName ? (
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="text"
                                        value={nameValue}
                                        onChange={e => setNameValue(e.target.value)}
                                        className="flex-1 bg-bg-surface border border-border-base rounded-lg px-3 py-1.5 text-text-base text-sm focus:outline-none focus:border-primary-base focus:ring-1 focus:ring-primary-base"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleNameSave}
                                        disabled={nameLoading}
                                        className="text-sm text-primary-base hover:text-primary-base/80 font-medium"
                                    >
                                        {nameLoading ? <Loader2 className="size-4 animate-spin" /> : '儲存'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingName(false)
                                            setNameValue(user.name ?? '')
                                        }}
                                        className="text-sm text-text-muted hover:text-text-base"
                                    >
                                        取消
                                    </button>
                                </div>
                            ) : (
                                <p className="text-text-base font-medium">
                                    {user.name || '（未設定）'}
                                    <button
                                        onClick={() => setEditingName(true)}
                                        className="ml-2 text-xs text-primary-base hover:underline"
                                    >
                                        編輯
                                    </button>
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Role */}
                    <div className="flex items-center gap-3">
                        <BarChart3 className="size-5 text-text-muted" />
                        <div>
                            <p className="text-xs text-text-muted">角色</p>
                            <span className="inline-block text-xs font-semibold text-primary-base bg-primary-base/10 rounded-full px-2.5 py-0.5 mt-0.5">
                                {user.role}
                            </span>
                        </div>
                    </div>

                    {/* Join date */}
                    <div className="flex items-center gap-3">
                        <Calendar className="size-5 text-text-muted" />
                        <div>
                            <p className="text-xs text-text-muted">加入日期</p>
                            <p className="text-text-base font-medium">
                                {new Date(user.createdAt).toLocaleDateString('zh-TW')}
                            </p>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3">
                        <BarChart3 className="size-5 text-text-muted" />
                        <div>
                            <p className="text-xs text-text-muted">作答紀錄</p>
                            <p className="text-text-base font-medium">
                                {user._count.questionRecords} 次
                            </p>
                        </div>
                    </div>
                </div>

                {/* Password Change */}
                <div className="card p-6 space-y-5">
                    <h2 className="text-lg font-heading font-semibold text-text-base flex items-center gap-2">
                        <Lock className="size-5 text-primary-base" />
                        修改密碼
                    </h2>

                    {pwMessage && (
                        <div
                            className={cn(
                                'p-3 rounded-lg text-sm font-medium flex items-center gap-2',
                                pwMessage.type === 'success'
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                            )}
                        >
                            {pwMessage.type === 'success' ? (
                                <Check className="size-4" />
                            ) : (
                                <AlertCircle className="size-4" />
                            )}
                            {pwMessage.text}
                        </div>
                    )}

                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-muted">目前密碼</label>
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={e => setCurrentPassword(e.target.value)}
                                required
                                className="w-full bg-bg-surface border border-border-base rounded-xl px-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-primary-base focus:ring-1 focus:ring-primary-base transition-all"
                                placeholder="輸入目前密碼"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-muted">新密碼</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                required
                                className="w-full bg-bg-surface border border-border-base rounded-xl px-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-primary-base focus:ring-1 focus:ring-primary-base transition-all"
                                placeholder="至少 8 字元，含大寫字母與數字"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-muted">確認新密碼</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                className="w-full bg-bg-surface border border-border-base rounded-xl px-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-primary-base focus:ring-1 focus:ring-primary-base transition-all"
                                placeholder="再次輸入新密碼"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={pwLoading}
                            className="w-full bg-primary-base hover:bg-primary-base/90 text-white font-medium py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                        >
                            {pwLoading ? <Loader2 className="size-4 animate-spin" /> : '修改密碼'}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    )
}
