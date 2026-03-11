"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { FileText, Loader2, AlertCircle, Clock, CheckCircle2, ChevronRight, XCircle } from "lucide-react";

interface Draft {
    id: string;
    originalFilename: string | null;
    status: 'PROCESSING' | 'AWAITING_REVIEW' | 'APPROVED' | 'REJECTED';
    createdAt: string;
    errorLog?: string;
    draftJson?: any;
}

export default function DraftsListPage() {
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchDrafts();
    }, []);

    const fetchDrafts = async () => {
        try {
            const res = await fetch('/api/parser/drafts');
            const data = await res.json();
            
            if (!res.ok || !data.ok) {
                throw new Error(data.error || "無法取得草稿列表");
            }

            setDrafts(data.data.drafts || []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "發生錯誤");
        } finally {
            setLoading(false);
        }
    };

    const getStatusConfig = (status: Draft['status']) => {
        switch (status) {
            case 'PROCESSING':
                return { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: '處理中', animate: 'animate-spin' };
            case 'AWAITING_REVIEW':
                return { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: '待審核', animate: '' };
            case 'APPROVED':
                return { icon: CheckCircle2, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20', text: '已發布', animate: '' };
            case 'REJECTED':
                return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', text: '已拒絕/失敗', animate: '' };
            default:
                return { icon: FileText, color: 'text-text-muted', bg: 'bg-bg-surface', border: 'border-border-base', text: '未知', animate: '' };
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-text-base mb-2">解析草稿管理</h1>
                    <p className="text-text-muted">檢視與審核所有上傳解析的試卷草稿</p>
                </div>
                <Link
                    href="/parser"
                    className="inline-flex items-center justify-center bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white px-5 py-2.5 rounded-lg shadow-lg shadow-teal-900/20 transition-all font-medium"
                >
                    <FileText className="w-4 h-4 mr-2" />
                    上傳新試卷
                </Link>
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start mb-6">
                    <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                    <p>{error}</p>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
                </div>
            ) : drafts.length === 0 ? (
                <div className="bg-bg-surface rounded-2xl border border-border-base p-12 text-center">
                    <FileText className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium text-text-base mb-2">目前沒有任何草稿</h3>
                    <p className="text-text-muted mb-6">您上傳的試卷解析完成後，會顯示在這裡等待您的審核。</p>
                    <Link
                        href="/parser"
                        className="inline-flex items-center text-teal-400 hover:text-teal-300 font-medium"
                    >
                        前往上傳 <ChevronRight className="w-4 h-4 ml-1" />
                    </Link>
                </div>
            ) : (
                <div className="bg-bg-surface rounded-2xl border border-border-base overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border-base bg-bg-base/50">
                                    <th className="px-6 py-4 font-medium text-sm text-text-muted">檔案名稱</th>
                                    <th className="px-6 py-4 font-medium text-sm text-text-muted">狀態</th>
                                    <th className="px-6 py-4 font-medium text-sm text-text-muted">題數</th>
                                    <th className="px-6 py-4 font-medium text-sm text-text-muted">建立時間</th>
                                    <th className="px-6 py-4 font-medium text-sm text-text-muted text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-base">
                                {drafts.map((draft) => {
                                    const statusConfig = getStatusConfig(draft.status);
                                    const Icon = statusConfig.icon;
                                    const qCount = draft.draftJson?.questions?.length || 0;

                                    return (
                                        <tr key={draft.id} className="hover:bg-bg-base/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center">
                                                    <FileText className="w-5 h-5 text-text-muted mr-3" />
                                                    <span className="font-medium text-text-base">
                                                        {draft.originalFilename || '未命名檔案'}
                                                    </span>
                                                </div>
                                                {draft.errorLog && (
                                                    <p className="text-xs text-red-400 mt-1 max-w-xs truncate" title={draft.errorLog}>
                                                        錯誤: {draft.errorLog}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusConfig.bg} ${statusConfig.border} ${statusConfig.color}`}>
                                                    <Icon className={`w-3.5 h-3.5 mr-1.5 ${statusConfig.animate}`} />
                                                    {statusConfig.text}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-text-base">{qCount > 0 ? `${qCount} 題` : '-'}</span>
                                            </td>
                                            <td className="px-6 py-4 text-text-muted text-sm">
                                                {format(new Date(draft.createdAt), 'yyyy/MM/dd HH:mm', { locale: zhTW })}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {draft.status === 'AWAITING_REVIEW' && (
                                                    <Link
                                                        href={`/parser/drafts/${draft.id}`}
                                                        className="inline-flex items-center text-teal-400 hover:text-teal-300 font-medium text-sm transition-colors"
                                                    >
                                                        前往審核
                                                    </Link>
                                                )}
                                                {draft.status === 'APPROVED' && (
                                                    <Link
                                                        href={`/parser/drafts/${draft.id}`}
                                                        className="inline-flex items-center text-text-muted hover:text-text-base font-medium text-sm transition-colors"
                                                    >
                                                        檢視
                                                    </Link>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}