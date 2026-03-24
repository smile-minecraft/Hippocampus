'use client'

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { BarChart3, Calendar, Check, Loader2, Lock, Mail, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { Field } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'

interface UserProfile {
    id: string
    email: string
    name: string | null
    role: string
    createdAt: string
    _count: { questionRecords: number }
}

export default function ProfilePage() {
    const [user, setUser] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editingName, setEditingName] = useState(false)
    const [nameValue, setNameValue] = useState('')
    const [nameLoading, setNameLoading] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [pwLoading, setPwLoading] = useState(false)
    const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const currentPasswordId = useId()
    const newPasswordId = useId()
    const confirmPasswordId = useId()

    useEffect(() => {
        let cancelled = false

        async function loadProfile() {
            try {
                const response = await fetch('/api/users/me', { credentials: 'include' })
                if (!response.ok) throw new Error('無法載入個人資料')

                const json = await response.json()
                if (!cancelled && json.ok) {
                    setUser(json.data)
                    setNameValue(json.data.name ?? '')
                }
            } catch (fetchError: unknown) {
                if (!cancelled) {
                    setError(fetchError instanceof Error ? fetchError.message : '載入失敗')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadProfile()
        return () => {
            cancelled = true
        }
    }, [])

    const getCsrfToken = useCallback(() => {
        const match = document.cookie.match(/(?:^|;\s*)__csrf_token=([^;]+)/)
        return match ? match[1] : ''
    }, [])

    const handleNameSave = useCallback(async () => {
        if (!nameValue.trim()) return
        setNameLoading(true)

        try {
            const response = await fetch('/api/users/me', {
                method: 'PATCH',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken(),
                },
                body: JSON.stringify({ name: nameValue.trim() }),
            })

            const json = await response.json()
            if (json.ok) {
                setUser((previous) => previous ? { ...previous, name: nameValue.trim() } : previous)
                setEditingName(false)
            }
        } finally {
            setNameLoading(false)
        }
    }, [getCsrfToken, nameValue])

    const handlePasswordChange = useCallback(async (event: React.FormEvent) => {
        event.preventDefault()
        setPwMessage(null)

        if (newPassword !== confirmPassword) {
            setPwMessage({ type: 'error', text: '新密碼與確認密碼不一致' })
            return
        }

        if (newPassword.length < 8) {
            setPwMessage({ type: 'error', text: '新密碼長度至少 8 個字元' })
            return
        }

        if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            setPwMessage({ type: 'error', text: '新密碼必須包含至少一個大寫字母與數字' })
            return
        }

        setPwLoading(true)

        try {
            const response = await fetch('/api/users/me/password', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': getCsrfToken(),
                },
                body: JSON.stringify({ currentPassword, newPassword }),
            })

            const json = await response.json()
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
    }, [confirmPassword, currentPassword, getCsrfToken, newPassword])

    if (loading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="size-8 animate-spin text-primary-base" />
            </div>
        )
    }

    if (error || !user) {
        return (
            <div className="notice notice-error" role="alert">
                <p className="text-sm font-medium text-text-base">{error || '請先登入'}</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Account"
                title="讓帳戶資訊與學習偏好維持在同一個編輯式頁面裡。"
                description="Profile 頁以清楚的資訊順序呈現：先看身份與角色，再處理安全設定，不再把資訊拆成互不相干的卡片堆。"
                meta={(
                    <>
                        <span className="pill">{user.role}</span>
                        <span className="pill">{user._count.questionRecords} 次作答</span>
                    </>
                )}
            />

            <div className="page-grid-with-rail">
                <div className="space-y-6">
                    <SectionCard title="帳戶資訊" description="更新姓名、查看角色與加入時間。">
                        <div className="grid gap-4 md:grid-cols-2">
                            <InfoBlock icon={<Mail className="size-4" />} label="電子郵件" value={user.email} />
                            <InfoBlock
                                icon={<BarChart3 className="size-4" />}
                                label="角色"
                                value={user.role}
                            />
                            <InfoBlock
                                icon={<Calendar className="size-4" />}
                                label="加入日期"
                                value={new Date(user.createdAt).toLocaleDateString('zh-TW')}
                            />
                            <InfoBlock
                                icon={<BarChart3 className="size-4" />}
                                label="作答紀錄"
                                value={`${user._count.questionRecords} 次`}
                            />
                        </div>

                        <div className="rounded-[24px] border border-border-base bg-bg-surface p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold text-text-base">姓名</p>
                                    {!editingName ? (
                                        <p className="text-sm leading-7 text-text-muted">{user.name || '尚未設定姓名'}</p>
                                    ) : null}
                                </div>
                                {!editingName ? (
                                    <Button variant="secondary" size="sm" onClick={() => setEditingName(true)}>
                                        <User className="size-4" />
                                        編輯姓名
                                    </Button>
                                ) : null}
                            </div>

                            {editingName ? (
                                <div className="mt-4 flex flex-col gap-3 md:flex-row">
                                    <input
                                        type="text"
                                        value={nameValue}
                                        onChange={(event) => setNameValue(event.target.value)}
                                        className="input flex-1"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <Button size="sm" isLoading={nameLoading} onClick={handleNameSave}>
                                            {!nameLoading ? '儲存' : null}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                setEditingName(false)
                                                setNameValue(user.name ?? '')
                                            }}
                                        >
                                            取消
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </SectionCard>

                    <SectionCard title="安全設定" description="修改密碼時，會立即更新登入保護條件。">
                        {pwMessage ? (
                            <div
                                className={cn(
                                    'notice',
                                    pwMessage.type === 'success' ? 'notice-success' : 'notice-error',
                                )}
                                role="status"
                                aria-live="polite"
                            >
                                <p className="text-sm font-medium text-text-base">{pwMessage.text}</p>
                            </div>
                        ) : null}
                        <form onSubmit={handlePasswordChange} className="space-y-5">
                            <Field label="目前密碼" htmlFor={currentPasswordId} required>
                                <input
                                    id={currentPasswordId}
                                    type="password"
                                    value={currentPassword}
                                    onChange={(event) => setCurrentPassword(event.target.value)}
                                    className="input"
                                    placeholder="輸入目前密碼"
                                    required
                                />
                            </Field>
                            <Field label="新密碼" htmlFor={newPasswordId} required hint="至少 8 個字元，包含一個大寫字母與數字。">
                                <input
                                    id={newPasswordId}
                                    type="password"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    className="input"
                                    placeholder="設定新密碼"
                                    required
                                />
                            </Field>
                            <Field label="確認新密碼" htmlFor={confirmPasswordId} required>
                                <input
                                    id={confirmPasswordId}
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    className="input"
                                    placeholder="再次輸入新密碼"
                                    required
                                />
                            </Field>
                            <Button type="submit" size="lg" className="w-full md:w-auto" isLoading={pwLoading}>
                                {!pwLoading ? '更新密碼' : null}
                            </Button>
                        </form>
                    </SectionCard>
                </div>

                <aside className="page-rail">
                    <SectionCard title="帳戶摘要" description="這裡保留最常回頭確認的三件事。">
                        <div className="space-y-3 text-sm leading-7 text-text-muted">
                            <p>目前身份：<span className="font-semibold text-text-base">{user.role}</span></p>
                            <p>資料建立於：<span className="font-semibold text-text-base">{new Date(user.createdAt).toLocaleDateString('zh-TW')}</span></p>
                            <p>如果你常切換螢幕尺寸，字體比例與主題偏好會保留在本機偏好裡。</p>
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </div>
    )
}

function InfoBlock({
    icon,
    label,
    value,
}: {
    icon: ReactNode
    label: string
    value: string
}) {
    return (
        <div className="rounded-[24px] border border-border-base bg-bg-surface p-4">
            <div className="flex items-center gap-2 text-text-subtle">
                {icon}
                <span className="text-sm font-medium">{label}</span>
            </div>
            <p className="mt-3 text-base font-semibold text-text-base">{value}</p>
        </div>
    )
}
