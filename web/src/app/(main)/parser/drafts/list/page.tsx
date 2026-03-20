"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
    AlertCircle,
    CheckCircle2,
    ChevronRight,
    Clock,
    FileText,
    Loader2,
    XCircle,
    type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";

interface Draft {
    id: string;
    originalFilename: string | null;
    status: "PROCESSING" | "AWAITING_REVIEW" | "APPROVED" | "REJECTED";
    createdAt: string;
    errorLog?: string;
    draftJson?: {
        questions?: unknown[];
    };
}

interface StatusConfig {
    icon: LucideIcon;
    toneClass: string;
    label: string;
    animate?: string;
}

function getStatusConfig(status: Draft["status"]): StatusConfig {
    switch (status) {
        case "PROCESSING":
            return {
                icon: Loader2,
                toneClass: "bg-primary-muted text-primary-base border-border-base",
                label: "處理中",
                animate: "animate-spin",
            };
        case "AWAITING_REVIEW":
            return {
                icon: Clock,
                toneClass: "bg-warning-muted text-warning-base border-warning-base/20",
                label: "待審核",
            };
        case "APPROVED":
            return {
                icon: CheckCircle2,
                toneClass: "bg-success-muted text-success-base border-success-base/20",
                label: "已發布",
            };
        case "REJECTED":
            return {
                icon: XCircle,
                toneClass: "bg-danger-muted text-danger-base border-danger-base/20",
                label: "已拒絕 / 失敗",
            };
        default:
            return {
                icon: FileText,
                toneClass: "bg-bg-surface text-text-muted border-border-base",
                label: "未知",
            };
    }
}

export default function DraftsListPage() {
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchDrafts() {
            try {
                const response = await fetch("/api/parser/drafts");
                const data = await response.json();

                if (!response.ok || !data.ok) {
                    throw new Error(data.error || "無法取得草稿列表");
                }

                setDrafts(data.data.drafts || []);
            } catch (draftError: unknown) {
                setError(draftError instanceof Error ? draftError.message : "發生錯誤");
            } finally {
                setLoading(false);
            }
        }

        void fetchDrafts();
    }, []);

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Parser / Drafts"
                title="解析草稿管理"
                description="所有上傳後的解析工作都會先落在這裡，再進入逐題審核與發布。"
                actions={(
                    <Link href="/parser" className="btn-primary">
                        <FileText className="size-4" />
                        上傳新試卷
                    </Link>
                )}
                meta={(
                    <>
                        <span className="pill">總草稿 {drafts.length}</span>
                        <span className="pill">等待人工審核</span>
                    </>
                )}
            />

            {error ? (
                <div className="notice notice-error" role="alert">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <p className="text-sm font-medium text-text-base">{error}</p>
                    </div>
                </div>
            ) : null}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="size-8 animate-spin text-primary-base" />
                </div>
            ) : drafts.length === 0 ? (
                <SectionCard title="目前沒有任何草稿" description="當你上傳新試卷後，系統會把解析結果先放到這裡。">
                    <div className="rounded-[26px] border border-dashed border-border-base bg-bg-surface px-6 py-14 text-center">
                        <FileText className="mx-auto size-12 text-text-subtle" />
                        <p className="mt-4 text-sm leading-7 text-text-muted">
                            解析完成後，這裡會顯示可進一步審核與發布的草稿。
                        </p>
                        <Link href="/parser" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-base">
                            前往上傳
                            <ChevronRight className="size-4" />
                        </Link>
                    </div>
                </SectionCard>
            ) : (
                <SectionCard
                    title="草稿列表"
                    description="檢查解析狀態、題數與錯誤資訊，再決定是否進一步審核。"
                    className="!p-0 overflow-hidden"
                >
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left">
                            <thead>
                                <tr className="border-b border-border-base bg-bg-base/50">
                                    <th className="px-6 py-4 text-sm font-medium text-text-muted">檔案名稱</th>
                                    <th className="px-6 py-4 text-sm font-medium text-text-muted">狀態</th>
                                    <th className="px-6 py-4 text-sm font-medium text-text-muted">題數</th>
                                    <th className="px-6 py-4 text-sm font-medium text-text-muted">建立時間</th>
                                    <th className="px-6 py-4 text-right text-sm font-medium text-text-muted">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-base">
                                {drafts.map((draft) => {
                                    const statusConfig = getStatusConfig(draft.status);
                                    const StatusIcon = statusConfig.icon;
                                    const questionCount = draft.draftJson?.questions?.length || 0;

                                    return (
                                        <tr key={draft.id} className="transition-colors hover:bg-bg-base/50">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <span className="inline-flex size-10 items-center justify-center rounded-2xl border border-border-base bg-bg-base text-text-muted">
                                                        <FileText className="size-4" />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-text-base">
                                                            {draft.originalFilename || "未命名檔案"}
                                                        </p>
                                                        {draft.errorLog ? (
                                                            <p className="mt-1 truncate text-xs text-danger-base" title={draft.errorLog}>
                                                                錯誤：{draft.errorLog}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusConfig.toneClass}`}>
                                                    <StatusIcon className={`size-3.5 ${statusConfig.animate || ""}`} />
                                                    {statusConfig.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-text-base">
                                                {questionCount > 0 ? `${questionCount} 題` : "-"}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-text-muted">
                                                {format(new Date(draft.createdAt), "yyyy/MM/dd HH:mm", { locale: zhTW })}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {draft.status === "AWAITING_REVIEW" ? (
                                                    <Link
                                                        href={`/parser/drafts/${draft.id}`}
                                                        className="text-sm font-semibold text-primary-base transition-colors hover:text-primary-hover"
                                                    >
                                                        前往審核
                                                    </Link>
                                                ) : draft.status === "APPROVED" ? (
                                                    <Link
                                                        href={`/parser/drafts/${draft.id}`}
                                                        className="text-sm font-semibold text-text-muted transition-colors hover:text-text-base"
                                                    >
                                                        檢視
                                                    </Link>
                                                ) : (
                                                    <span className="text-sm text-text-subtle">等待中</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            )}
        </div>
    );
}
