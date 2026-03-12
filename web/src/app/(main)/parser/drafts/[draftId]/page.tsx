"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, Save, Check, X, ArrowLeft, Image as ImageIcon, Tags, Wand2, AlertTriangle } from "lucide-react";
import { GroupedTagMultiSelect } from "@/components/quiz/GroupedTagMultiSelect";
import { FormatIssueList, FormatWarningSummary } from "@/components/parser/FormatWarningBadge";
import { analyzeQuestionFormat, analyzeQuestionsFormat, getHighestSeverity, type QuestionToAnalyze } from "@/lib/validation/question-format";
import { formatQuestions, type QuestionToFormat } from "@/lib/validation/question-formatter";

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
    const [formatting, setFormatting] = useState(false);
    const [showFormatDialog, setShowFormatDialog] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [metadata, setMetadata] = useState<{ year?: number; examType?: string }>({});
    const [questions, setQuestions] = useState<DraftQuestion[]>([]);

    // Format analysis
    const formatAnalysis = useMemo(() => {
        const questionsToAnalyze: QuestionToAnalyze[] = questions.map(q => ({
            stem: q.stem,
            explanation: q.explanation,
        }));
        return analyzeQuestionsFormat(questionsToAnalyze);
    }, [questions]);

    const hasFormatIssues = formatAnalysis.totalIssues > 0;

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

    const handleAutoFormat = useCallback(() => {
        setFormatting(true);
        setError(null);
        setSuccess(null);

        try {
            const questionsToFormat: QuestionToFormat[] = questions.map(q => ({
                stem: q.stem,
                options: q.options,
                explanation: q.explanation,
            }));

            const { questions: formattedQuestions, summary } = formatQuestions(questionsToFormat);

            // Merge formatted data back with original questions (preserving other fields)
            const newQuestions = questions.map((q, idx) => ({
                ...q,
                stem: formattedQuestions[idx].stem,
                options: formattedQuestions[idx].options,
                explanation: formattedQuestions[idx].explanation === null ? undefined : formattedQuestions[idx].explanation,
            }));

            setQuestions(newQuestions);

            if (summary.totalFormatted > 0) {
                setSuccess(`已自動修復 ${summary.totalFormatted} 題的格式問題（共 ${summary.totalChanges} 處修改）`);
            } else {
                setSuccess("所有題目格式正確，無需修復");
            }

            setShowFormatDialog(false);
            setTimeout(() => setSuccess(null), 5000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "格式化失敗");
        } finally {
            setFormatting(false);
        }
    }, [questions]);

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

    const scrollToFirstIssue = () => {
        const firstIssueElement = document.querySelector('[data-format-issue="error"]');
        if (firstIssueElement) {
            firstIssueElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                <div className="flex gap-3 flex-wrap">
                    {hasFormatIssues && (
                        <FormatWarningSummary
                            totalIssues={formatAnalysis.totalIssues}
                            questionsWithIssues={formatAnalysis.questionsWithIssues}
                            onClick={scrollToFirstIssue}
                        />
                    )}
                    <button
                        onClick={() => setShowFormatDialog(true)}
                        disabled={saving || publishing || formatting || error?.includes("已經審核發布過")}
                        className="flex items-center justify-center bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 text-purple-400 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {formatting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                        一鍵格式化
                    </button>
                    <button
                        onClick={handleSaveDraft}
                        disabled={saving || publishing || formatting || error?.includes("已經審核發布過")}
                        className="flex items-center justify-center bg-bg-surface border border-border-base hover:border-teal-500/50 text-text-base px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        儲存草稿
                    </button>
                    <button
                        onClick={handlePublish}
                        disabled={saving || publishing || formatting || error?.includes("已經審核發布過") || questions.length === 0}
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

            {/* Format Dialog */}
            {showFormatDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-bg-surface rounded-xl border border-border-base p-6 max-w-lg w-full shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                                <Wand2 className="w-5 h-5 text-purple-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-text-base">一鍵格式化</h3>
                                <p className="text-sm text-text-muted">自動修復 AI 萃取的格式問題</p>
                            </div>
                        </div>

                        <div className="space-y-3 mb-6">
                            <div className="p-3 bg-bg-base rounded-lg">
                                <h4 className="text-sm font-medium text-text-base mb-2">將自動修復：</h4>
                                <ul className="text-sm text-text-muted space-y-1">
                                    <li className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                                        從題幹中分離選項 (A)(B)(C)(D)
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                                        移除詳解中的題號前綴（第122題、Q122等）
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                                        清理「解析：」「答案：」等多餘前綴
                                    </li>
                                </ul>
                            </div>

                            {hasFormatIssues && (
                                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                    <div className="flex items-center gap-2 text-amber-400 text-sm">
                                        <AlertTriangle className="w-4 h-4" />
                                        <span>檢測到 {formatAnalysis.totalIssues} 個問題需要修復</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowFormatDialog(false)}
                                className="flex-1 px-4 py-2 bg-bg-base border border-border-base rounded-lg text-text-base hover:border-border-hover transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleAutoFormat}
                                disabled={formatting}
                                className="flex-1 px-4 py-2 bg-purple-500 hover:bg-purple-400 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {formatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                確認修復
                            </button>
                        </div>
                    </div>
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
                    questions.map((q, qIndex) => {
                        const severity = getHighestSeverity({
                            stem: q.stem,
                            explanation: q.explanation,
                        });

                        return (
                            <div
                                key={qIndex}
                                className="bg-bg-surface rounded-xl border border-border-base p-5 relative group"
                                data-format-issue={severity !== 'none' ? severity : undefined}
                            >
                                <button
                                    onClick={() => removeQuestion(qIndex)}
                                    className="absolute top-4 right-4 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="刪除此題"
                                >
                                    <X className="w-5 h-5" />
                                </button>

                                <div className="flex items-center gap-2 mb-4 flex-wrap">
                                    <span className="bg-teal-500/10 text-teal-400 font-bold px-3 py-1 rounded-md text-sm">
                                        Q {qIndex + 1}
                                    </span>
                                    <FormatIssueList
                                        issues={analyzeQuestionFormat({
                                            stem: q.stem,
                                            explanation: q.explanation,
                                        })}
                                    />
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

                                    {/* Tags */}
                                    <div>
                                        <label className="flex items-center text-sm font-medium text-text-muted mb-1">
                                            <Tags className="w-3.5 h-3.5 mr-1.5" />
                                            標籤設定
                                            {q.tagSlugs && q.tagSlugs.length > 0 && (
                                                <span className="ml-2 text-xs text-teal-400">
                                                    已選 {q.tagSlugs.length} 個
                                                </span>
                                            )}
                                        </label>
                                        <GroupedTagMultiSelect
                                            selectedSlugs={q.tagSlugs ?? []}
                                            onChange={(slugs) => handleQuestionChange(qIndex, 'tagSlugs', slugs)}
                                            className="w-full bg-bg-base/40"
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
