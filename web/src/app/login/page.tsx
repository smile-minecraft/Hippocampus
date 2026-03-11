"use client"
import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, Loader2 } from 'lucide-react';

export default function LoginPage() {
    const searchParams = useSearchParams();
    const redirect = searchParams.get('redirect') || '/';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const text = await res.text();
            let data: Record<string, unknown> = {};
            try { data = JSON.parse(text); } catch { /* ignore */ }

            if (!res.ok || (data && !data.ok)) {
                throw new Error((data.message as string) || (data.error as string) || '登入失敗，請檢查帳號密碼');
            }

            // Redirect to the original page or default
            window.location.href = redirect;
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '登入失敗');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-base flex justify-center items-center p-4">
            <div className="max-w-md w-full bg-slate-800/80 p-8 rounded-2xl border border-slate-700 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-teal-400 to-cyan-500"></div>

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-500 mb-2">
                        Hippocampus
                    </h1>
                    <p className="text-slate-400 text-sm">系統身分驗證中心</p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center font-medium">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300 ml-1">電子郵件</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-5 w-5 text-slate-500" />
                            <input
                                type="email"
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                required
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300 ml-1">密碼</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-500" />
                            <input
                                type="password"
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                autoComplete="current-password"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-teal-900/20 flex justify-center items-center mt-4 disabled:opacity-70"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '安全登入'}
                    </button>

                    <p className="text-sm text-slate-400 text-center mt-4">
                        沒有帳號？{' '}
                        <Link href="/register" className="text-teal-400 hover:underline font-medium">
                            建立帳號
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
