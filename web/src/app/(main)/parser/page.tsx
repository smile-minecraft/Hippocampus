"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, File, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

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

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    };

    const handleFileSelect = (selectedFile: File) => {
        setError(null);
        setSuccessMsg(null);
        
        // 限制檔案類型 (Word, PDF)
        const validTypes = [
            "application/pdf", 
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword"
        ];
        
        if (!validTypes.includes(selectedFile.type) && !selectedFile.name.endsWith('.docx') && !selectedFile.name.endsWith('.pdf')) {
            setError("只支援 PDF 與 Word (.docx) 檔案格式");
            return;
        }

        // 限制大小 (例如 10MB)
        if (selectedFile.size > 10 * 1024 * 1024) {
            setError("檔案大小不能超過 10MB");
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

    // 取得 Pre-signed URL 後，直接將檔案 PUT 到 MinIO
    // 然後通知後端將 Job 丟入 Queue
    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setProgress(10); // 取得簽名 URL 階段

        try {
            // 1. Get Presigned URL
            const presignRes = await fetch("/api/upload/presign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type || "application/octet-stream",
                }),
            });

            const presignData = await presignRes.json();
            if (!presignRes.ok || !presignData.ok) {
                throw new Error(presignData.error || "無法取得上傳授權");
            }

            const { url, minioKey } = presignData.data;
            setProgress(30);

            // 2. Upload file directly to MinIO (or S3) via the presigned URL
            // Next.js can't track native fetch progress easily without XMLHttpRequest,
            // but for simplicity we'll just await it and fake progress.
            const uploadRes = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
                body: file,
            });

            if (!uploadRes.ok) {
                throw new Error("檔案上傳失敗");
            }
            setProgress(70);

            // 3. Notify backend to bind the file and start parsing job
            const bindRes = await fetch("/api/upload/bind", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    minioKey,
                    filename: file.name,
                }),
            });

            const bindData = await bindRes.json();
            if (!bindRes.ok || !bindData.ok) {
                throw new Error(bindData.error || "後端處理檔案失敗");
            }

            setProgress(100);
            setSuccessMsg("檔案上傳成功！已進入解析排程。");
            setJobId(bindData.data.jobId);
            setFile(null);

        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "上傳過程發生錯誤");
            setProgress(0);
        } finally {
            setIsUploading(false);
        }
    };

    // Polling job status
    useEffect(() => {
        if (!jobId) return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/parser/status/${jobId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.data) {
                        const status = data.data.status;
                        
                        if (status === 'COMPLETED' || status === 'FAILED') {
                            clearInterval(interval);
                            
                            if (status === 'COMPLETED' && data.data.draftId) {
                                router.push(`/parser/drafts/${data.data.draftId}`);
                            } else if (status === 'FAILED') {
                                setError("解析作業失敗，請確認檔案內容是否符合格式，或稍後再試。");
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore silent poll errors
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [jobId, router]);

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-text-base mb-2">考古題上傳解析</h1>
                <p className="text-text-muted">上傳 Word 或 PDF 檔，系統將自動解析出題目並建立草稿。</p>
            </div>

            <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-base mb-4">上傳檔案</h2>

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start">
                        <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {successMsg && !jobId && (
                    <div className="mb-6 p-4 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-xl flex items-start">
                        <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                        <p className="text-sm">{successMsg}</p>
                    </div>
                )}

                {jobId && (
                    <div className="mb-6 p-6 bg-teal-900/10 border border-teal-500/30 rounded-xl flex flex-col items-center justify-center space-y-4">
                        <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
                        <div className="text-center">
                            <p className="font-medium text-teal-400 mb-1">正在由 AI 解析考卷中...</p>
                            <p className="text-sm text-text-muted">這通常需要 1-3 分鐘，請勿關閉視窗。完成後將自動跳轉至草稿審核頁面。</p>
                        </div>
                    </div>
                )}

                {!jobId && (
                    <>
                        <div
                            className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all ${
                                isDragging
                                    ? "border-teal-500 bg-teal-500/5"
                                    : "border-border-base bg-bg-base/50 hover:bg-bg-base hover:border-border-hover"
                            } ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => !file && !isUploading && fileInputRef.current?.click()}
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
                                <div className="flex flex-col items-center w-full max-w-sm" onClick={e => e.stopPropagation()}>
                                    <div className="w-16 h-16 bg-teal-500/10 rounded-full flex items-center justify-center mb-4 relative">
                                        <File className="w-8 h-8 text-teal-400" />
                                        <button
                                            onClick={clearFile}
                                            disabled={isUploading}
                                            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors disabled:opacity-50"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <p className="font-medium text-text-base text-center truncate w-full px-4">{file.name}</p>
                                    <p className="text-sm text-text-muted mt-1">
                                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                                    </p>

                                    {isUploading && (
                                        <div className="w-full mt-6">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-teal-400">上傳中...</span>
                                                <span className="text-text-muted">{progress}%</span>
                                            </div>
                                            <div className="h-2 w-full bg-bg-base rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all duration-300"
                                                    style={{ width: `${progress}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center pointer-events-none">
                                    <div className="w-16 h-16 bg-bg-surface border border-border-base rounded-full flex items-center justify-center mb-4">
                                        <UploadCloud className="w-8 h-8 text-text-muted" />
                                    </div>
                                    <p className="font-medium text-text-base mb-1">點擊或拖曳檔案至此處</p>
                                    <p className="text-sm text-text-muted text-center max-w-xs">
                                        支援 PDF, Word 格式<br />檔案大小限制 10MB
                                    </p>
                                </div>
                            )}
                        </div>

                        {file && !isUploading && (
                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={handleUpload}
                                    className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-teal-900/20 transition-all flex items-center"
                                >
                                    開始上傳並解析
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm mt-8">
                <h3 className="font-semibold text-text-base mb-4">上傳須知</h3>
                <ul className="space-y-2 text-sm text-text-muted list-disc list-inside ml-4">
                    <li>系統會自動使用 AI 分析考卷，將題幹、選項與答案分離。</li>
                    <li>如果是圖片題（例如有配圖的選擇題），請盡量確認圖片解析度清晰，AI 會嘗試萃取圖片內容。</li>
                    <li>上傳完成後，不會立刻進入題庫。您會進入「草稿審核」頁面，可以手動修改 AI 辨識錯誤的地方，確認無誤後再行發布。</li>
                    <li>單次解析作業可能需要 1~3 分鐘，請耐心等候。</li>
                </ul>
            </div>
        </div>
    );
}