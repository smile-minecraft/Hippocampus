"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, File, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";

export default function ParserUploadPage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);

        if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            handleFileSelect(event.dataTransfer.files[0]);
        }
    };

    const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            handleFileSelect(event.target.files[0]);
        }
    };

    const handleFileSelect = (selectedFile: File) => {
        setError(null);
        setSuccessMsg(null);

        const validTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        ];

        if (
            !validTypes.includes(selectedFile.type) &&
            !selectedFile.name.endsWith(".docx") &&
            !selectedFile.name.endsWith(".pdf")
        ) {
            setError("只支援 PDF 與 Word (.docx) 檔案格式。");
            return;
        }

        if (selectedFile.size > 10 * 1024 * 1024) {
            setError("檔案大小不能超過 10MB。");
            return;
        }

        setFile(selectedFile);
    };

    const clearFile = () => {
        setFile(null);
        setError(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setProgress(10);

        try {
            const presignResponse = await fetch("/api/upload/presign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type || "application/octet-stream",
                }),
            });

            const presignData = await presignResponse.json();
            if (!presignResponse.ok || !presignData.ok) {
                throw new Error(presignData.error || "無法取得上傳授權");
            }

            const { url, minioKey } = presignData.data;
            setProgress(35);

            const uploadResponse = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error("檔案上傳失敗");
            }

            setProgress(72);

            const bindResponse = await fetch("/api/upload/bind", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    minioKey,
                    filename: file.name,
                }),
            });

            const bindData = await bindResponse.json();
            if (!bindResponse.ok || !bindData.ok) {
                throw new Error(bindData.error || "後端處理檔案失敗");
            }

            setProgress(100);
            setSuccessMsg("檔案上傳成功，已進入解析排程。");
            setJobId(bindData.data.jobId);
            setFile(null);
        } catch (uploadError: unknown) {
            setError(uploadError instanceof Error ? uploadError.message : "上傳過程發生錯誤");
            setProgress(0);
        } finally {
            setIsUploading(false);
        }
    };

    useEffect(() => {
        if (!jobId) return;

        const interval = window.setInterval(async () => {
            try {
                const response = await fetch(`/api/parser/status/${jobId}`);
                if (!response.ok) return;

                const data = await response.json();
                if (!data.ok || !data.data) return;

                const status = data.data.status;
                if (status === "COMPLETED" || status === "FAILED") {
                    window.clearInterval(interval);

                    if (status === "COMPLETED" && data.data.draftId) {
                        router.push(`/parser/drafts/${data.data.draftId}`);
                    } else if (status === "FAILED") {
                        setError("解析作業失敗，請確認檔案內容是否符合格式，或稍後再試。");
                        setJobId(null);
                    }
                }
            } catch {
                // Ignore transient polling errors.
            }
        }, 3000);

        return () => window.clearInterval(interval);
    }, [jobId, router]);

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Parser Workspace"
                title="把考卷文件送進解析流程，接著直接進入可編輯的草稿審核。"
                description="上傳與等待狀態都放在同一個頁面裡。版面維持低干擾，但保留解析工作站需要的明確狀態回饋。"
                meta={(
                    <>
                        <span className="pill">支援 PDF / DOCX</span>
                        <span className="pill">10MB 內</span>
                        <span className="pill">完成後自動跳轉草稿</span>
                    </>
                )}
            />

            <div className="page-grid-with-rail">
                <div className="space-y-6">
                    <SectionCard
                        title="上傳檔案"
                        description="拖曳或點擊上傳考卷，系統會先取得授權，再將文件送入解析佇列。"
                    >
                        {error ? (
                            <div className="notice notice-error" role="alert">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                                    <p className="text-sm font-medium text-text-base">{error}</p>
                                </div>
                            </div>
                        ) : null}

                        {successMsg && !jobId ? (
                            <div className="notice notice-success" role="status">
                                <div className="flex items-start gap-3">
                                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                                    <p className="text-sm font-medium text-text-base">{successMsg}</p>
                                </div>
                            </div>
                        ) : null}

                        {jobId ? (
                            <div className="rounded-[26px] border border-border-base bg-bg-surface px-6 py-10 text-center">
                                <Loader2 className="mx-auto size-8 animate-spin text-primary-base" />
                                <p className="mt-4 text-base font-semibold text-text-base">正在由 AI 解析考卷中...</p>
                                <p className="mt-2 text-sm leading-7 text-text-muted">
                                    這通常需要 1 到 3 分鐘，完成後會自動跳轉到草稿審核頁面。
                                </p>
                            </div>
                        ) : (
                            <>
                                <div
                                    className={[
                                        "rounded-[30px] border-2 border-dashed px-6 py-12 transition-all",
                                        isDragging
                                            ? "border-primary-base bg-primary-muted/40"
                                            : "border-border-base bg-bg-surface hover:border-border-hover hover:bg-surface-muted",
                                        isUploading ? "pointer-events-none opacity-60" : "cursor-pointer",
                                    ].join(" ")}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => {
                                        if (!file && !isUploading) {
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                        onChange={handleFileInput}
                                        disabled={isUploading}
                                    />

                                    {file ? (
                                        <div
                                            className="mx-auto flex w-full max-w-md flex-col items-center"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <div className="relative mb-4 inline-flex size-16 items-center justify-center rounded-full border border-border-base bg-bg-base">
                                                <File className="size-8 text-primary-base" />
                                                <button
                                                    type="button"
                                                    onClick={clearFile}
                                                    disabled={isUploading}
                                                    className="absolute -right-2 -top-2 inline-flex size-7 items-center justify-center rounded-full bg-danger-base text-white transition-colors hover:bg-danger-base/90 disabled:opacity-50"
                                                    aria-label="移除檔案"
                                                >
                                                    <X className="size-4" />
                                                </button>
                                            </div>
                                            <p className="w-full truncate px-4 text-center text-base font-semibold text-text-base">
                                                {file.name}
                                            </p>
                                            <p className="mt-1 text-sm text-text-muted">
                                                {(file.size / (1024 * 1024)).toFixed(2)} MB
                                            </p>

                                            {isUploading ? (
                                                <div className="mt-6 w-full">
                                                    <div className="mb-2 flex items-center justify-between text-xs">
                                                        <span className="text-primary-base">上傳中...</span>
                                                        <span className="text-text-muted">{progress}%</span>
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-bg-base">
                                                        <div
                                                            className="h-full rounded-full bg-cta-base transition-all duration-300"
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="pointer-events-none flex flex-col items-center">
                                            <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full border border-border-base bg-bg-base">
                                                <UploadCloud className="size-8 text-text-muted" />
                                            </div>
                                            <p className="text-base font-semibold text-text-base">點擊或拖曳檔案至此處</p>
                                            <p className="mt-2 max-w-xs text-center text-sm leading-7 text-text-muted">
                                                支援 PDF 與 Word 格式，單檔大小限制 10MB。
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {file && !isUploading ? (
                                    <div className="flex justify-end">
                                        <Button onClick={() => void handleUpload()}>
                                            開始上傳並解析
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </SectionCard>
                </div>

                <aside className="page-rail">
                    <SectionCard title="上傳須知">
                        <ul className="space-y-3 text-sm leading-7 text-text-muted">
                            <li>系統會自動分析題幹、選項與答案，並建立可編輯的草稿。</li>
                            <li>若題目含圖片，請盡量提供清晰版面，方便 OCR 與圖像解析。</li>
                            <li>解析完成後不會直接入庫，你仍可在草稿審核頁手動修正。</li>
                            <li>若輪詢中斷，重新整理頁面後仍可在草稿列表中找到最新工作。</li>
                        </ul>
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
}
