"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    Check,
    Image as ImageIcon,
    Loader2,
    Save,
    Tags,
    Wand2,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useFeedback } from "@/components/ui/FeedbackProvider";
import { GroupedTagMultiSelect } from "@/components/quiz/GroupedTagMultiSelect";
import { FormatIssueList, FormatWarningSummary } from "@/components/parser/FormatWarningBadge";
import {
    analyzeQuestionFormat,
    analyzeQuestionsFormat,
    getHighestSeverity,
    type QuestionToAnalyze,
} from "@/lib/validation/question-format";
import { formatQuestions, type QuestionToFormat } from "@/lib/validation/question-formatter";

interface DraftQuestionPayload {
    stem: string;
    options: Record<string, string>;
    answer: string;
    explanation?: string;
    imagePlaceholders?: string[];
    tagSlugs?: string[];
    difficulty?: number;
}

interface DraftQuestion extends DraftQuestionPayload {
    clientId: string;
}

function createClientId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function withClientIds(items: DraftQuestionPayload[]): DraftQuestion[] {
    return items.map((item) => ({
        ...item,
        clientId: createClientId(),
    }));
}

function stripClientIds(items: DraftQuestion[]) {
    return items.map(({ clientId, ...rest }) => rest);
}

export default function DraftReviewPage() {
    const params = useParams();
    const router = useRouter();
    const draftId = params.draftId as string;
    const { confirm, notify } = useFeedback();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [formatting, setFormatting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [lockMessage, setLockMessage] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<{ year?: number; examType?: string }>({});
    const [questions, setQuestions] = useState<DraftQuestion[]>([]);

    const formatAnalysis = useMemo(() => {
        const questionsToAnalyze: QuestionToAnalyze[] = questions.map((question) => ({
            stem: question.stem,
            explanation: question.explanation,
        }));

        return analyzeQuestionsFormat(questionsToAnalyze);
    }, [questions]);

    const hasFormatIssues = formatAnalysis.totalIssues > 0;
    const isReadOnly = Boolean(lockMessage);
    const isBusy = saving || publishing || formatting;

    useEffect(() => {
        async function fetchDraft() {
            try {
                const response = await fetch(`/api/parser/drafts/${draftId}`);
                const data = await response.json();

                if (!response.ok || !data.ok) {
                    throw new Error(data.error || "無法載入草稿");
                }

                if (data.data.status === "APPROVED") {
                    setLockMessage("此草稿已經審核發布過，無法再次編輯。");
                } else if (data.data.status === "REJECTED") {
                    setLockMessage("此草稿已被拒絕，目前僅可檢視內容。");
                } else {
                    setLockMessage(null);
                }

                const draftJson = data.data.draftJson;
                setMetadata(draftJson.metadata || {});
                setQuestions(withClientIds(draftJson.questions || []));
            } catch (draftError: unknown) {
                setError(draftError instanceof Error ? draftError.message : "發生錯誤");
            } finally {
                setLoading(false);
            }
        }

        if (draftId) {
            void fetchDraft();
        }
    }, [draftId]);

    const resetMessages = useCallback(() => {
        setError(null);
        setSuccess(null);
    }, []);

    const handleSaveDraft = useCallback(async () => {
        setSaving(true);
        resetMessages();

        try {
            const response = await fetch(`/api/parser/drafts/${draftId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    metadata,
                    questions: stripClientIds(questions),
                }),
            });

            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.error || "儲存草稿失敗");
            }

            setSuccess("草稿已成功儲存。");
            notify({
                tone: "success",
                title: "草稿已儲存",
                description: "目前的修訂內容已保留在草稿中。",
            });
        } catch (saveError: unknown) {
            const message = saveError instanceof Error ? saveError.message : "儲存失敗";
            setError(message);
            notify({ tone: "error", title: "儲存失敗", description: message });
        } finally {
            setSaving(false);
        }
    }, [draftId, metadata, notify, questions, resetMessages]);

    const handlePublish = useCallback(async () => {
        const accepted = await confirm({
            title: "確認發布這份草稿？",
            description: "發布後題目會直接寫入題庫。建議先完成格式修正與標籤校對，再進行這一步。",
            confirmLabel: "發布到題庫",
            tone: "danger",
        });

        if (!accepted) return;

        setPublishing(true);
        resetMessages();

        try {
            const response = await fetch(`/api/parser/drafts/${draftId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    year: metadata.year,
                    examType: metadata.examType,
                }),
            });

            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.error || "發布失敗");
            }

            setSuccess("發布成功，正在返回解析工作區。");
            notify({
                tone: "success",
                title: "發布成功",
                description: "題目已寫入題庫，系統會帶你回解析工作區。",
            });

            window.setTimeout(() => {
                router.push("/parser");
            }, 1400);
        } catch (publishError: unknown) {
            const message = publishError instanceof Error ? publishError.message : "發布失敗";
            setError(message);
            notify({ tone: "error", title: "發布失敗", description: message });
        } finally {
            setPublishing(false);
        }
    }, [confirm, draftId, metadata.examType, metadata.year, notify, resetMessages, router]);

    const handleAutoFormat = useCallback(async () => {
        const accepted = await confirm({
            title: "套用一鍵格式化？",
            description: "系統會自動拆分題幹中的選項、清理詳解前綴，並保留你目前的標籤與難度設定。",
            confirmLabel: "開始修復",
        });

        if (!accepted) return;

        setFormatting(true);
        resetMessages();

        try {
            const questionsToFormat: QuestionToFormat[] = questions.map((question) => ({
                stem: question.stem,
                options: question.options,
                explanation: question.explanation,
            }));

            const { questions: formattedQuestions, summary } = formatQuestions(questionsToFormat);

            setQuestions((currentQuestions) =>
                currentQuestions.map((question, index) => ({
                    ...question,
                    stem: formattedQuestions[index].stem,
                    options: formattedQuestions[index].options,
                    explanation:
                        formattedQuestions[index].explanation === null
                            ? undefined
                            : formattedQuestions[index].explanation,
                })),
            );

            if (summary.totalFormatted > 0) {
                const message = `已自動修復 ${summary.totalFormatted} 題的格式問題，共 ${summary.totalChanges} 處修改。`;
                setSuccess(message);
                notify({ tone: "success", title: "格式修復完成", description: message });
            } else {
                const message = "所有題目格式都已經一致，暫時不需要自動修復。";
                setSuccess(message);
                notify({ tone: "info", title: "目前格式良好", description: message });
            }
        } catch (formatError: unknown) {
            const message = formatError instanceof Error ? formatError.message : "格式化失敗";
            setError(message);
            notify({ tone: "error", title: "格式化失敗", description: message });
        } finally {
            setFormatting(false);
        }
    }, [confirm, notify, questions, resetMessages]);

    const handleQuestionChange = useCallback(
        <K extends keyof DraftQuestionPayload>(index: number, field: K, value: DraftQuestionPayload[K]) => {
            setQuestions((currentQuestions) => {
                const nextQuestions = [...currentQuestions];
                nextQuestions[index] = { ...nextQuestions[index], [field]: value };
                return nextQuestions;
            });
        },
        [],
    );

    const handleOptionChange = useCallback((questionIndex: number, optionKey: string, value: string) => {
        setQuestions((currentQuestions) => {
            const nextQuestions = [...currentQuestions];
            nextQuestions[questionIndex] = {
                ...nextQuestions[questionIndex],
                options: {
                    ...nextQuestions[questionIndex].options,
                    [optionKey]: value,
                },
            };
            return nextQuestions;
        });
    }, []);

    const removeQuestion = useCallback(async (index: number) => {
        const accepted = await confirm({
            title: "刪除這題？",
            description: "題目會從這份草稿中移除，但在你儲存草稿之前不會真的寫回後端。",
            confirmLabel: "刪除題目",
            tone: "danger",
        });

        if (!accepted) return;

        setQuestions((currentQuestions) => currentQuestions.filter((_, currentIndex) => currentIndex !== index));
        notify({ tone: "success", title: "已從草稿移除題目" });
    }, [confirm, notify]);

    const scrollToFirstIssue = useCallback(() => {
        const firstIssueElement = document.querySelector('[data-format-issue="error"]');
        if (firstIssueElement instanceof HTMLElement) {
            firstIssueElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="size-8 animate-spin text-primary-base" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Parser / Draft Review"
                title="草稿審核：把 AI 解析結果整理成可直接入庫的題目。"
                description="這個頁面保留清晰的閱讀節奏，同時維持足夠的表單密度，方便你快速校對題幹、選項、詳解與標籤。"
                actions={
                    <>
                        <Button variant="secondary" onClick={() => router.push("/parser")}>
                            <ArrowLeft className="size-4" />
                            返回解析列表
                        </Button>
                        {hasFormatIssues ? (
                            <FormatWarningSummary
                                totalIssues={formatAnalysis.totalIssues}
                                questionsWithIssues={formatAnalysis.questionsWithIssues}
                                onClick={scrollToFirstIssue}
                            />
                        ) : null}
                        <Button
                            variant="secondary"
                            onClick={() => void handleAutoFormat()}
                            disabled={isBusy || isReadOnly || questions.length === 0}
                        >
                            {formatting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                            一鍵格式化
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => void handleSaveDraft()}
                            disabled={isBusy || isReadOnly}
                            isLoading={saving}
                        >
                            {!saving ? <Save className="size-4" /> : null}
                            {!saving ? "儲存草稿" : null}
                        </Button>
                        <Button
                            onClick={() => void handlePublish()}
                            disabled={isBusy || isReadOnly || questions.length === 0}
                            isLoading={publishing}
                        >
                            {!publishing ? <Check className="size-4" /> : null}
                            {!publishing ? "核准並發布" : null}
                        </Button>
                    </>
                }
                meta={
                    <>
                        <span className="pill">{questions.length} 題</span>
                        <span className="pill">
                            {hasFormatIssues
                                ? `${formatAnalysis.totalIssues} 個格式問題`
                                : "格式檢查已通過"}
                        </span>
                        {lockMessage ? <span className="pill">{lockMessage}</span> : null}
                    </>
                }
            />

            {lockMessage ? (
                <div className="notice notice-warning" role="status">
                    <p className="text-sm font-medium text-text-base">{lockMessage}</p>
                </div>
            ) : null}

            {error ? (
                <div className="notice notice-error" role="alert">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <p className="text-sm font-medium text-text-base">{error}</p>
                    </div>
                </div>
            ) : null}

            {success ? (
                <div className="notice notice-success" role="status" aria-live="polite">
                    <div className="flex items-start gap-3">
                        <Check className="mt-0.5 size-4 shrink-0" />
                        <p className="text-sm font-medium text-text-base">{success}</p>
                    </div>
                </div>
            ) : null}

            <div className="page-grid-with-rail">
                <div className="space-y-6">
                    <SectionCard title="試卷元資料" description="發布前可先修正年份與考試類別，避免入庫後還要回頭整理卷別。">
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="年度 (Year)" htmlFor="draft-metadata-year">
                                <input
                                    id="draft-metadata-year"
                                    type="number"
                                    value={metadata.year || ""}
                                    onChange={(event) =>
                                        setMetadata((current) => ({
                                            ...current,
                                            year: Number.parseInt(event.target.value, 10) || undefined,
                                        }))
                                    }
                                    className="input"
                                    placeholder="例如：2024"
                                    disabled={isReadOnly}
                                />
                            </Field>
                            <Field label="考試類別 (Exam Type)" htmlFor="draft-metadata-exam-type">
                                <input
                                    id="draft-metadata-exam-type"
                                    type="text"
                                    value={metadata.examType || ""}
                                    onChange={(event) =>
                                        setMetadata((current) => ({
                                            ...current,
                                            examType: event.target.value,
                                        }))
                                    }
                                    className="input"
                                    placeholder="例如：醫師一階、期末考"
                                    disabled={isReadOnly}
                                />
                            </Field>
                        </div>
                    </SectionCard>

                    <SectionCard
                        title={`解析題目列表 (${questions.length} 題)`}
                        description="先看格式問題，再逐題校對內容。列表使用穩定 client id，刪除或重排時不會再讓輸入框與焦點錯位。"
                    >
                        {questions.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-border-base bg-bg-surface px-6 py-12 text-center text-sm text-text-muted">
                                沒有解析出任何題目。
                            </div>
                        ) : (
                            <div className="space-y-5">
                                {questions.map((question, questionIndex) => {
                                    const severity = getHighestSeverity({
                                        stem: question.stem,
                                        explanation: question.explanation,
                                    });

                                    return (
                                        <article
                                            key={question.clientId}
                                            className="rounded-[26px] border border-border-base bg-bg-surface p-5 shadow-sm"
                                            data-format-issue={severity !== "none" ? severity : undefined}
                                        >
                                            <div className="flex flex-col gap-4">
                                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="pill">Q {questionIndex + 1}</span>
                                                        <FormatIssueList
                                                            issues={analyzeQuestionFormat({
                                                                stem: question.stem,
                                                                explanation: question.explanation,
                                                            })}
                                                        />
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => void removeQuestion(questionIndex)}
                                                        disabled={isReadOnly}
                                                    >
                                                        <X className="size-4" />
                                                        刪除此題
                                                    </Button>
                                                </div>

                                                <Field label="題幹" htmlFor={`draft-stem-${question.clientId}`}>
                                                    <textarea
                                                        id={`draft-stem-${question.clientId}`}
                                                        value={question.stem}
                                                        onChange={(event) =>
                                                            handleQuestionChange(questionIndex, "stem", event.target.value)
                                                        }
                                                        rows={4}
                                                        className="input min-h-[8.5rem] resize-y"
                                                        disabled={isReadOnly}
                                                    />
                                                </Field>

                                                {question.imagePlaceholders && question.imagePlaceholders.length > 0 ? (
                                                    <div className="rounded-[22px] border border-dashed border-border-base bg-bg-base px-4 py-3">
                                                        <div className="flex items-center gap-2 text-sm font-medium text-warning-base">
                                                            <ImageIcon className="size-4" />
                                                            <span>AI 偵測到圖片佔位資訊</span>
                                                        </div>
                                                        <p className="mt-2 text-xs leading-6 text-text-muted">
                                                            {question.imagePlaceholders.join(", ")}
                                                        </p>
                                                    </div>
                                                ) : null}

                                                <div className="space-y-3">
                                                    <p className="text-sm font-semibold text-text-base">選項與答案</p>
                                                    <div className="grid gap-3">
                                                        {Object.entries(question.options || {}).map(([optionKey, text]) => (
                                                            <label
                                                                key={optionKey}
                                                                htmlFor={`draft-option-${question.clientId}-${optionKey}`}
                                                                className="rounded-[22px] border border-border-base bg-bg-base px-4 py-3"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <input
                                                                        type="radio"
                                                                        name={`answer-${question.clientId}`}
                                                                        checked={question.answer === optionKey}
                                                                        onChange={() =>
                                                                            handleQuestionChange(questionIndex, "answer", optionKey)
                                                                        }
                                                                        className="size-4 border-border-base bg-bg-base text-primary-base"
                                                                        disabled={isReadOnly}
                                                                    />
                                                                    <span className="w-6 text-sm font-semibold text-text-base">
                                                                        {optionKey}.
                                                                    </span>
                                                                    <input
                                                                        id={`draft-option-${question.clientId}-${optionKey}`}
                                                                        type="text"
                                                                        value={text}
                                                                        onChange={(event) =>
                                                                            handleOptionChange(
                                                                                questionIndex,
                                                                                optionKey,
                                                                                event.target.value,
                                                                            )
                                                                        }
                                                                        className="min-w-0 flex-1 bg-transparent text-sm text-text-base outline-none placeholder:text-text-subtle"
                                                                        placeholder={`輸入 ${optionKey} 選項內容`}
                                                                        disabled={isReadOnly}
                                                                    />
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>

                                                <Field label="詳解 (可選)" htmlFor={`draft-explanation-${question.clientId}`}>
                                                    <textarea
                                                        id={`draft-explanation-${question.clientId}`}
                                                        value={question.explanation || ""}
                                                        onChange={(event) =>
                                                            handleQuestionChange(
                                                                questionIndex,
                                                                "explanation",
                                                                event.target.value,
                                                            )
                                                        }
                                                        rows={4}
                                                        className="input min-h-[7rem] resize-y"
                                                        placeholder="如果需要，可在這裡補充詳解。"
                                                        disabled={isReadOnly}
                                                    />
                                                </Field>

                                                <div className="space-y-2">
                                                    <label className="flex items-center gap-2 text-sm font-semibold text-text-base">
                                                        <Tags className="size-4" />
                                                        標籤設定
                                                        {question.tagSlugs && question.tagSlugs.length > 0 ? (
                                                            <span className="text-xs font-medium text-primary-base">
                                                                已選 {question.tagSlugs.length} 個
                                                            </span>
                                                        ) : null}
                                                    </label>
                                                    <GroupedTagMultiSelect
                                                        selectedSlugs={question.tagSlugs ?? []}
                                                        onChange={(slugs) =>
                                                            handleQuestionChange(questionIndex, "tagSlugs", slugs)
                                                        }
                                                        className="w-full bg-bg-base/40"
                                                    />
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>
                </div>

                <aside className="page-rail">
                    <SectionCard title="校對摘要" description="把最常回頭確認的資訊收在同一欄。">
                        <div className="space-y-3 text-sm leading-7 text-text-muted">
                            <p>
                                目前共有 <span className="font-semibold text-text-base">{questions.length}</span> 題。
                            </p>
                            <p>
                                {hasFormatIssues ? (
                                    <>
                                        偵測到{" "}
                                        <span className="font-semibold text-warning-base">
                                            {formatAnalysis.totalIssues}
                                        </span>{" "}
                                        個格式問題，建議先修正再發布。
                                    </>
                                ) : (
                                    <>格式檢查目前通過，接下來可以專注在內容與標籤校對。</>
                                )}
                            </p>
                            <p>
                                發布時只會送出原本的 API wire format，`clientId` 只存在於前端，專門用來穩定列表互動。
                            </p>
                        </div>
                    </SectionCard>

                    <SectionCard title="一鍵格式化會做什麼？">
                        <ul className="space-y-3 text-sm leading-7 text-text-muted">
                            <li className="flex items-start gap-2">
                                <AlertTriangle className="mt-1 size-4 shrink-0 text-warning-base" />
                                從題幹中拆出混在一起的 `(A)(B)(C)(D)` 選項。
                            </li>
                            <li className="flex items-start gap-2">
                                <AlertTriangle className="mt-1 size-4 shrink-0 text-warning-base" />
                                清掉「解析：」「答案：」這類詳解前綴。
                            </li>
                            <li className="flex items-start gap-2">
                                <AlertTriangle className="mt-1 size-4 shrink-0 text-warning-base" />
                                保留標籤、圖片佔位與難度，不改動非格式欄位。
                            </li>
                        </ul>
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
}
