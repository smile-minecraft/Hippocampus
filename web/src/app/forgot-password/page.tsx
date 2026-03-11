"use client"
import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const text = await res.text();
            let data: Record<string, unknown> = {};
            try { data = JSON.parse(text); } catch { /* ignore */ }

            if (!res.ok || (data && !data.ok)) {
                throw new Error((data.message as string) || (data.error as string) || '發送失敗，請稍後再試');
            }

            setSuccess(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '發送失敗');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-base flex justify-center items-center p-4">
            <div className="max-w-md w-full bg-bg-surface p-8 rounded-2xl border border-border-base shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-teal-400 to-cyan-500"></div>

                <div className="mb-6">
                    <Link href="/login" className="inline-flex items-center text-sm text-text-muted hover:text-teal-400 transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        返回登入
                    </Link>
                </div>

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-500 mb-2">
                        重設密碼
                    </h1>
                    <p className="text-text-muted text-sm">
                        請輸入您註冊時使用的電子郵件，我們將發送重設密碼連結給您。
                    </p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center font-medium">
                        {error}
                    </div>
                )}

                {success ? (
                    <div className="text-center space-y-4">
                        <div className="flex justify-center">
                            <CheckCircle2 className="w-16 h-16 text-teal-400" />
                        </div>
                        <p className="text-text-base font-medium">重設連結已發送！</p>
                        <p className="text-sm text-text-muted">
                            請檢查您的電子郵件信箱。如果幾分鐘內未收到，請檢查垃圾郵件匣。
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
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
                                    autoComplete="email"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-teal-900/20 flex justify-center items-center mt-4 disabled:opacity-70"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '發送重設連結'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}