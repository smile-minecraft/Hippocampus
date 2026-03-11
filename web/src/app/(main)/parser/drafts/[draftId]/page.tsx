"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, Save, Check, X, ArrowLeft, Image as ImageIcon } from "lucide-react";

interface DraftQuestion {
    stem: string;
    options: Record<string, string>;
    answer: string;
    explanation?: string;
    imagePlaceholders?: string[];
    tagSlugs?: string[];
    difficulty?: number;
}

export default function DraftReviewPage() {
    const params = useParams();
    const router = useRouter();
    const draftId = params.draftId as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [metadata, setMetadata] = useState<{ year?: number; examType?: string }>({});
    const [questions, setQuestions] = useState<DraftQuestion[]>([]);

    useEffect(() => {
        const fetchDraft = async () => {
            try {
                const res = await fetch(`/api/parser/drafts/${draftId}`);
                const data = await res.json();

                if (!res.ok || !data.ok) {
                    throw new Error(data.error || "無法載入草稿");
                }

                if (data.data.status === 'APPROVED') {
                    setError("此草稿已經審核發布過，無法再次編輯。");
                } else if (data.data.status === 'REJECTED') {
                    setError("此草稿已被拒絕。");
                }

                const draftJson = data.data.draftJson;
                setMetadata(draftJson.metadata || {});
                setQuestions(draftJson.questions || []);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "發生錯誤");
            } finally {
                setLoading(false);
            }
        };

        if (draftId) {
            fetchDraft();
        }
    }, [draftId]);

    const handleSaveDraft = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const res = await fetch(`/api/parser/drafts/${draftId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    metadata,
                    questions,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || "儲存草稿失敗");
            }

            setSuccess("草稿已成功儲存！");
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "儲存失敗");
        } finally {
            setSaving(false);
        }
    };

    const handlePublish = async () => {
        if (!confirm("確定要發布這些題目嗎？發布後將直接寫入題庫。")) return;

        setPublishing(true);
        setError(null);
        setSuccess(null);

        try {
            // 可以一併送出 metadata 的修正，API 端已實作 body overrides
            const res = await fetch(`/api/parser/drafts/${draftId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    year: metadata.year,
                    examType: metadata.examType,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || "發布失敗");
            }

            setSuccess("發布成功！已寫入題庫。");
            setTimeout(() => {
                router.push('/parser'); // 發布成功後導回上傳頁面或題庫管理頁面
            }, 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "發布失敗");
            setPublishing(false);
        }
    };

    const handleQuestionChange = (index: number, field: keyof DraftQuestion, value: any) => {
        const newQuestions = [...questions];
        newQuestions[index] = { ...newQuestions[index], [field]: value };
        setQuestions(newQuestions);
    };

    const handleOptionChange = (qIndex: number, optionKey: string, value: string) => {
        const newQuestions = [...questions];
        const newOptions = { ...newQuestions[qIndex].options, [optionKey]: value };
        newQuestions[qIndex] = { ...newQuestions[qIndex], options: newOptions };
        setQuestions(newQuestions);
    };

    const removeQuestion = (index: number) => {
        if (confirm("確定要刪除這題嗎？")) {
            const newQuestions = [...questions];
            newQuestions.splice(index, 1);
            setQuestions(newQuestions);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <button
                        onClick={() => router.push('/parser')}
                        className="flex items-center text-text-muted hover:text-teal-400 mb-2 transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        返回上傳列表
                    </button>
                    <h1 className="text-2xl font-bold text-text-base">草稿審核：檢閱解析結果</h1>
                    <p className="text-text-muted text-sm mt-1">請確認 AI 解析的題幹與選項是否正確。修正無誤後點擊「核准並發布」。</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleSaveDraft}
                        disabled={saving || publishing || error?.includes("已經審核發布過")}
                        className="flex items-center justify-center bg-bg-surface border border-border-base hover:border-teal-500/50 text-text-base px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        儲存草稿
                    </button>
                    <button
                        onClick={handlePublish}
                        disabled={saving || publishing || error?.includes("已經審核發布過") || questions.length === 0}
                        className="flex items-center justify-center bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white px-5 py-2 rounded-lg shadow-lg shadow-teal-900/20 transition-all disabled:opacity-50"
                    >
                        {publishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                        核准並發布
                    </button>
                </div>
            </div>

            {/* Alerts */}
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start">
                    <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                    <p>{error}</p>
                </div>
            )}
            {success && (
                <div className="p-4 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-xl flex items-start">
                    <Check className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                    <p>{success}</p>
                </div>
            )}

            {/* Metadata Section */}
            <div className="bg-bg-surface rounded-xl border border-border-base p-5">
                <h2 className="text-lg font-semibold text-text-base mb-4">試卷元資料 (Metadata)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-text-muted mb-1">年度 (Year)</label>
                        <input
                            type="number"
                            value={metadata.year || ''}
                            onChange={(e) => setMetadata({ ...metadata, year: parseInt(e.target.value) || undefined })}
                            className="w-full bg-bg-base border border-border-base rounded-lg px-3 py-2 text-text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                            placeholder="例如：2024"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-text-muted mb-1">考試類別 (Exam Type)</label>
                        <input
                            type="text"
                            value={metadata.examType || ''}
                            onChange={(e) => setMetadata({ ...metadata, examType: e.target.value })}
                            className="w-full bg-bg-base border border-border-base rounded-lg px-3 py-2 text-text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                            placeholder="例如：醫師一階、期末考"
                        />
                    </div>
                </div>
            </div>

            {/* Questions List */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text-base">解析題目列表 (共 {questions.length} 題)</h2>
                </div>

                {questions.length === 0 ? (
                    <div className="text-center py-12 bg-bg-surface rounded-xl border border-border-base border-dashed">
                        <p className="text-text-muted">沒有解析出任何題目。</p>
                    </div>
                ) : (
                    questions.map((q, qIndex) => (
                        <div key={qIndex} className="bg-bg-surface rounded-xl border border-border-base p-5 relative group">
                            <button
                                onClick={() => removeQuestion(qIndex)}
                                className="absolute top-4 right-4 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="刪除此題"
                            >
                                <X className="w-5 h-5" />
                            </button>
                            
                            <div className="flex items-center gap-2 mb-4">
                                <span className="bg-teal-500/10 text-teal-400 font-bold px-3 py-1 rounded-md text-sm">
                                    Q {qIndex + 1}
                                </span>
                            </div>

                            <div className="space-y-4">
                                {/* Stem */}
                                <div>
                                    <label className="block text-sm font-medium text-text-muted mb-1">題幹</label>
                                    <textarea
                                        value={q.stem}
                                        onChange={(e) => handleQuestionChange(qIndex, 'stem', e.target.value)}
                                        rows={3}
                                        className="w-full bg-bg-base border border-border-base rounded-lg px-3 py-2 text-text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all resize-y"
                                    />
                                </div>

                                {/* Images */}
                                {q.imagePlaceholders && q.imagePlaceholders.length > 0 && (
                                    <div className="p-3 bg-bg-base rounded-lg border border-border-base border-dashed">
                                        <div className="flex items-center text-sm text-amber-400/80 mb-2">
                                            <ImageIcon className="w-4 h-4 mr-2" />
                                            <span>AI 標記了此題包含圖片：</span>
                                        </div>
                                        <div className="text-xs text-text-muted bg-black/20 p-2 rounded">
                                            {q.imagePlaceholders.join(', ')}
                                        </div>
                                    </div>
                                )}

                                {/* Options */}
                                <div>
                                    <label className="block text-sm font-medium text-text-muted mb-2">選項</label>
                                    <div className="space-y-2">
                                        {Object.entries(q.options || {}).map(([key, text]) => (
                                            <div key={key} className="flex items-center gap-3">
                                                <div className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        name={`answer-${qIndex}`}
                                                        checked={q.answer === key}
                                                        onChange={() => handleQuestionChange(qIndex, 'answer', key)}
                                                        className="w-4 h-4 text-teal-500 focus:ring-teal-500 border-border-base bg-bg-base"
                                                    />
                                                    <span className="ml-2 font-medium w-6 text-text-base">{key}.</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={text}
                                                    onChange={(e) => handleOptionChange(qIndex, key, e.target.value)}
                                                    className="flex-1 bg-bg-base border border-border-base rounded-lg px-3 py-1.5 text-sm text-text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Explanation */}
                                <div>
                                    <label className="block text-sm font-medium text-text-muted mb-1">詳解 (可選)</label>
                                    <textarea
                                        value={q.explanation || ''}
                                        onChange={(e) => handleQuestionChange(qIndex, 'explanation', e.target.value)}
                                        rows={2}
                                        className="w-full bg-bg-base border border-border-base rounded-lg px-3 py-2 text-sm text-text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all resize-y"
                                        placeholder="無詳解"
                                    />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}