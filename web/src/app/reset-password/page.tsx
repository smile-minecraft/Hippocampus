"use client"
import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Loader2, CheckCircle2 } from 'lucide-react';

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    if (!token) {
        return (
            <div className="text-center space-y-4">
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm font-medium">
                    無效的重設連結或連結已過期
                </div>
                <Link href="/forgot-password" className="inline-flex items-center text-sm text-teal-400 hover:underline transition-colors">
                    重新申請重設密碼
                </Link>
            </div>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        if (password !== confirmPassword) {
            setError('兩次輸入的密碼不一致');
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
            });
            const text = await res.text();
            let data: Record<string, unknown> = {};
            try { data = JSON.parse(text); } catch { /* ignore */ }

            if (!res.ok || (data && !data.ok)) {
                throw new Error((data.message as string) || (data.error as string) || '重設失敗，連結可能已過期');
            }

            setSuccess(true);
            setTimeout(() => {
                router.push('/login');
            }, 3000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '重設失敗');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="text-center space-y-4">
                <div className="flex justify-center">
                    <CheckCircle2 className="w-16 h-16 text-teal-400" />
                </div>
                <p className="text-text-base font-medium">密碼重設成功！</p>
                <p className="text-sm text-text-muted">
                    您現在可以使用新密碼登入。正在為您導向登入頁面...
                </p>
                <div className="pt-4">
                    <Link href="/login" className="inline-flex items-center text-sm text-teal-400 hover:underline transition-colors">
                        立即登入
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <>
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center font-medium">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-muted ml-1">新密碼</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                        <input
                            type="password"
                            className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={8}
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-muted ml-1">確認新密碼</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
                        <input
                            type="password"
                            className="w-full bg-bg-base border border-border-base rounded-xl pl-10 pr-4 py-2.5 text-text-base placeholder-text-muted focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={8}
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-teal-900/20 flex justify-center items-center mt-4 disabled:opacity-70"
                >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '確認重設'}
                </button>
            </form>
        </>
    );
}

export default function ResetPasswordPage() {
    return (
        <div className="min-h-screen bg-bg-base flex justify-center items-center p-4">
            <div className="max-w-md w-full bg-bg-surface p-8 rounded-2xl border border-border-base shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-teal-400 to-cyan-500"></div>

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-500 mb-2">
                        設定新密碼
                    </h1>
                    <p className="text-text-muted text-sm">
                        請輸入您的新密碼，密碼長度至少需為 8 個字元。
                    </p>
                </div>

                <Suspense fallback={
                    <div className="flex justify-center p-4">
                        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
                    </div>
                }>
                    <ResetPasswordForm />
                </Suspense>
            </div>
        </div>
    );
}