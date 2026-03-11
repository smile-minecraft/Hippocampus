"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2, AlertTriangle, Edit2, Merge, Trash2 } from "lucide-react";
import { fetchAdminTags, createAdminTag, updateAdminTag, deleteAdminTag, mergeAdminTags, AdminTagListResponse } from "@/lib/apiClient";
import { CreateTagPayload } from "@/lib/schemas";

export default function TagsManagerPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [dimension, setDimension] = useState("");

    // Modals state
    const [_editingTag, setEditingTag] = useState<AdminTagListResponse['data'][number] | null>(null);
    const [mergingTag, setMergingTag] = useState<AdminTagListResponse['data'][number] | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const { data: tagsData, isLoading, isError, error } = useQuery<AdminTagListResponse>({
        queryKey: ["admin-tags", page, search, dimension],
        queryFn: () => fetchAdminTags(page, 50, search, dimension),
        retry: 1, // Don't retry auth errors infinitely
    });

    const existingGroups = useMemo(() => {
        if (!tagsData?.data) return [];
        const groups = tagsData.data.map(t => t.groupName).filter(Boolean);
        return Array.from(new Set(groups)) as string[];
    }, [tagsData]);

    // Usage statistics
    const tagStats = useMemo(() => {
        if (!tagsData?.data) return null;
        const total = tagsData.data.length;
        const unused = tagsData.data.filter(t => (t._count?.questions || 0) === 0).length;
        const totalQuestionLinks = tagsData.data.reduce((sum, t) => sum + (t._count?.questions || 0), 0);
        const byDimension = tagsData.data.reduce<Record<string, number>>((acc, t) => {
            acc[t.dimension] = (acc[t.dimension] || 0) + 1;
            return acc;
        }, {});
        return { total, unused, totalQuestionLinks, byDimension };
    }, [tagsData]);

    // Mutators
    const mergeMutation = useMutation({
        mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) => mergeAdminTags(sourceId, targetId),
        onSuccess: () => {
            setMergingTag(null);
            // Invalidate BOTH tags and questions
            queryClient.invalidateQueries({ queryKey: ["admin-tags"] });
            queryClient.invalidateQueries({ queryKey: ["quiz-tags"] });
            queryClient.invalidateQueries({ queryKey: ["questions"] });
        }
    });

    const _editMutation = useMutation({
        mutationFn: (vars: { id: string, payload: Partial<CreateTagPayload> }) => updateAdminTag(vars.id, vars.payload),
        onSuccess: () => {
            setEditingTag(null);
            queryClient.invalidateQueries({ queryKey: ["admin-tags"] });
            queryClient.invalidateQueries({ queryKey: ["quiz-tags"] });
        }
    });

    const createMutation = useMutation({
        mutationFn: createAdminTag,
        onSuccess: () => {
            setIsCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ["admin-tags"] });
            queryClient.invalidateQueries({ queryKey: ["quiz-tags"] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: deleteAdminTag,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-tags"] });
            queryClient.invalidateQueries({ queryKey: ["quiz-tags"] });
        }
    });



    return (
        <>
            <main className="min-h-screen bg-bg-base pb-12 transition-colors duration-300">
                <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto text-slate-100">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-500">
                                標籤系統管理中心
                            </h1>
                            <p className="text-slate-400 mt-1">管理與合併全站多維度題庫標籤</p>
                        </div>
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-semibold transition"
                        >
                            新增標籤
                        </button>
                    </div>

                    <div className="flex gap-4 mb-6">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="搜尋標籤名稱或群組..."
                                className="w-full pl-10 pr-4 py-2 bg-slate-800 border-slate-700 rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            />
                        </div>
                        <select
                            className="px-4 py-2 bg-slate-800 border-slate-700 rounded-lg text-sm outline-none"
                            value={dimension}
                            onChange={(e) => { setDimension(e.target.value); setPage(1); }}
                        >
                            <option value="">所有維度</option>
                            <option value="ACADEMIC">ACADEMIC (基礎學科)</option>
                            <option value="ORGAN">ORGAN (臨床器官)</option>
                            <option value="EXAM_CATEGORY">EXAM_CATEGORY (考試類別)</option>
                            <option value="META">META (通用狀態)</option>
                        </select>
                    </div>

                    {/* Usage Statistics Summary */}
                    {tagStats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                                <div className="text-2xl font-bold text-slate-100">{tagStats.total}</div>
                                <div className="text-xs text-slate-400 mt-1">此頁標籤數</div>
                            </div>
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                                <div className="text-2xl font-bold text-teal-400">{tagStats.totalQuestionLinks}</div>
                                <div className="text-xs text-slate-400 mt-1">題目關聯總數</div>
                            </div>
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                                <div className={`text-2xl font-bold ${tagStats.unused > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                                    {tagStats.unused}
                                </div>
                                <div className="text-xs text-slate-400 mt-1">未使用標籤</div>
                            </div>
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                                <div className="flex gap-2 flex-wrap">
                                    {Object.entries(tagStats.byDimension).map(([dim, count]) => (
                                        <span key={dim} className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                                            {dim}: {count}
                                        </span>
                                    ))}
                                </div>
                                <div className="text-xs text-slate-400 mt-1">維度分佈</div>
                            </div>
                        </div>
                    )}

                    <div className="bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700">
                                <tr>
                                    <th className="px-6 py-4 font-medium">標籤名稱 (Name)</th>
                                    <th className="px-6 py-4 font-medium">維度 (Dimension)</th>
                                    <th className="px-6 py-4 font-medium">所屬群組 (Group)</th>
                                    <th className="px-6 py-4 font-medium text-right">關聯題目數</th>
                                    <th className="px-6 py-4 font-medium text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                            載入中...
                                        </td>
                                    </tr>
                                ) : isError ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-red-400">
                                            <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-80" />
                                            取得資料失敗：{error?.message || "未授權或發生未知錯誤。若是 401，請確認已登入管理員權限 (或嘗試 /api/auth/dev-login)"}
                                        </td>
                                    </tr>
                                ) : tagsData?.data.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                                            沒有找到符合條件的標籤
                                        </td>
                                    </tr>
                                ) : tagsData?.data.map((tag) => (
                                    <tr key={tag.id} className="hover:bg-slate-800 transition-colors">
                                        <td className="px-6 py-3 font-medium text-slate-200">
                                            <div className="flex items-center gap-2">
                                                {tag.name}
                                                <span className="text-xs text-slate-500">({tag.slug})</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="px-2 py-1 rounded bg-slate-700/50 text-xs text-indigo-300">
                                                {tag.dimension}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-slate-300">
                                            {tag.groupName || <span className="text-slate-600">—</span>}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            {(() => {
                                                const count = tag._count?.questions || 0;
                                                const colorClass = count === 0
                                                    ? "bg-red-500/15 text-red-400"
                                                    : count < 5
                                                        ? "bg-amber-500/15 text-amber-400"
                                                        : "bg-green-500/15 text-green-400";
                                                return (
                                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                                                        {count}
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <div className="flex justify-end gap-2 text-slate-400">
                                                <button
                                                    onClick={() => setEditingTag(tag)}
                                                    className="p-1.5 hover:bg-slate-700 hover:text-white rounded" title="編輯"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => setMergingTag(tag)}
                                                    className="p-1.5 hover:bg-orange-500/20 hover:text-orange-400 rounded transition" title="合併至..."
                                                >
                                                    <Merge className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => { if (confirm(`確定刪除標籤 ${tag.name}？關聯將被抹除！`)) deleteMutation.mutate(tag.id) }}
                                                    className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded transition" title="強制刪除"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {tagsData && tagsData.meta.totalPages > 1 && (
                        <div className="flex justify-center gap-2 pt-4">
                            <button
                                disabled={page === 1}
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50"
                            >
                                上一頁
                            </button>
                            <span className="px-3 py-1 text-slate-400">
                                {page} / {tagsData.meta.totalPages}
                            </span>
                            <button
                                disabled={page === tagsData.meta.totalPages}
                                onClick={() => setPage(p => p + 1)}
                                className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50"
                            >
                                下一頁
                            </button>
                        </div>
                    )}

                    {/* Merge Danger Zone Modal */}
                    {mergingTag && <MergeTagModal sourceTag={mergingTag} onClose={() => setMergingTag(null)} onMerge={(targetId) => mergeMutation.mutate({ sourceId: mergingTag.id, targetId })} isMerging={mergeMutation.isPending} />}

                    {/* Create Tag Modal */}
                    {isCreateOpen && (
                        <CreateTagModal
                            onClose={() => setIsCreateOpen(false)}
                            onCreate={(data) => createMutation.mutate(data)}
                            isCreating={createMutation.isPending}
                            existingGroups={existingGroups}
                        />
                    )}
                </div>
            </main>
        </>
    );
}

// ---------------------------------------------------------------------------
// Tag Merge Modal Component
// ---------------------------------------------------------------------------
function MergeTagModal({ sourceTag, onClose, onMerge, isMerging }: { sourceTag: AdminTagListResponse['data'][number], onClose: () => void, onMerge: (targetId: string) => void, isMerging: boolean }) {
    const [searchQuery, setSearchQuery] = useState("");
    const [targetTagId, setTargetTagId] = useState("");
    const [confirmName, setConfirmName] = useState("");

    // Minimal search implementation for target tags (Async Select placeholder behavior)
    const { data: searchResults } = useQuery<AdminTagListResponse>({
        queryKey: ["merge-search", searchQuery],
        queryFn: () => fetchAdminTags(1, 20, searchQuery),
        enabled: searchQuery.length > 0,
    });

    const isMatch = confirmName === sourceTag.name;
    const canSubmit = isMatch && targetTagId && targetTagId !== sourceTag.id && !isMerging;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-red-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex items-center gap-3 text-red-400 mb-4">
                        <div className="bg-red-500/10 p-2 rounded-full">
                            <AlertTriangle className="h-6 w-6" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-100">危險區域：標籤合併</h2>
                    </div>

                    <p className="text-slate-300 text-sm leading-relaxed mb-6">
                        您正準備將圖書庫中所有關聯至 <strong className="text-white px-1.5 py-0.5 bg-slate-800 rounded">{sourceTag.name}</strong> 的題目轉移至另一個標籤，並<strong className="text-red-400 font-bold ml-1">徹除</strong>原來的來源實體。此操作不可逆轉，請格外小心。
                    </p>

                    <div className="space-y-5">
                        <div className="space-y-2 relative">
                            <label className="text-sm font-medium text-slate-300">1. 尋找目標標籤</label>
                            <input
                                type="text"
                                placeholder="輸入關鍵字尋找要合併過去的標籤..."
                                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-indigo-500 outline-none"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {/* Simple Dropdown for searching */}
                            {searchResults && searchResults.data.length > 0 && searchQuery && (
                                <div className="absolute top-16 w-full max-h-48 overflow-y-auto bg-slate-800 border-x border-b border-slate-700 rounded-b-lg shadow-xl z-10">
                                    {searchResults.data.filter(t => t.id !== sourceTag.id).map(t => (
                                        <div
                                            key={t.id}
                                            onClick={() => { setTargetTagId(t.id); setSearchQuery(t.name); }}
                                            className={`px-4 py-2 text-sm cursor-pointer hover:bg-indigo-600 ${targetTagId === t.id ? "bg-indigo-600 font-bold" : ""}`}
                                        >
                                            {t.name} <span className="text-slate-400 text-xs ml-2">{t.groupName || t.dimension}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">
                                2. 確認防護機制 <span className="text-slate-500 text-xs">(阻斷肌肉記憶)</span>
                            </label>
                            <p className="text-xs text-red-400/80 mb-1">
                                請手動輸入即將被消滅的來源名稱「<span className="font-bold text-white select-all">{sourceTag.name}</span>」以解除鎖定。
                            </p>
                            <input
                                type="text"
                                placeholder={sourceTag.name}
                                className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-700 rounded-lg text-sm text-red-300 focus:border-red-500 outline-none font-mono"
                                value={confirmName}
                                onChange={(e) => setConfirmName(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 bg-slate-950/50 flex justify-end gap-3 border-t border-slate-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-300 hover:text-white transition"
                    >
                        取消
                    </button>
                    <button
                        disabled={!canSubmit}
                        onClick={() => onMerge(targetTagId)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed flex justify-center items-center gap-2 min-w-[100px]"
                    >
                        {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : "確認消滅並合併"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Slug auto-generation helper
// ---------------------------------------------------------------------------
function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")  // keep letters (incl. CJK), digits, spaces, hyphens
        .replace(/[\s_]+/g, "-")              // spaces / underscores → hyphens
        .replace(/-+/g, "-")                  // collapse consecutive hyphens
        .replace(/^-|-$/g, "");               // trim leading/trailing hyphens
}

// ---------------------------------------------------------------------------
// Create Tag Modal Component
// ---------------------------------------------------------------------------
function CreateTagModal({ onClose, onCreate, isCreating, existingGroups }: { onClose: () => void, onCreate: (data: CreateTagPayload) => void, isCreating: boolean, existingGroups: string[] }) {
    const [name, setName] = useState("");
    const [slugOverride, setSlugOverride] = useState("");
    const [dimension, setDimension] = useState<CreateTagPayload["dimension"]>("ACADEMIC");
    const [groupName, setGroupName] = useState("");
    const [showGroupSuggestions, setShowGroupSuggestions] = useState(false);

    const autoSlug = generateSlug(name);
    const effectiveSlug = slugOverride || autoSlug;

    const filteredGroups = existingGroups.filter(g => g.toLowerCase().includes(groupName.toLowerCase()) && g !== groupName);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !effectiveSlug) return;
        onCreate({
            name: name.trim(),
            slug: effectiveSlug,
            dimension,
            groupName: groupName.trim() || null,
        });
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-teal-500/30 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <div className="flex items-center gap-3 text-teal-400 mb-6">
                            <h2 className="text-xl font-bold text-slate-100">新增標籤</h2>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">標籤名稱 (Name) <span className="text-red-400">*</span></label>
                                <input
                                    type="text"
                                    required
                                    placeholder="例如：生理解剖學、循環系統"
                                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">
                                    Slug <span className="text-slate-500 text-xs">(自動從名稱產生，可手動覆寫)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder={autoSlug || "auto-generated-slug"}
                                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition font-mono"
                                    value={slugOverride}
                                    onChange={(e) => setSlugOverride(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                />
                                {effectiveSlug && (
                                    <p className="text-xs text-slate-500">預覽: <code className="text-teal-400">{effectiveSlug}</code></p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">所屬維度 (Dimension) <span className="text-red-400">*</span></label>
                                <select
                                    required
                                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition"
                                    value={dimension}
                                    onChange={(e) => setDimension(e.target.value as CreateTagPayload["dimension"])}
                                >
                                    <option value="ACADEMIC">ACADEMIC (基礎學科)</option>
                                    <option value="ORGAN">ORGAN (人體器官)</option>
                                    <option value="EXAM_CATEGORY">EXAM_CATEGORY (考試類別)</option>
                                    <option value="META">META (通用狀態)</option>
                                </select>
                                <p className="text-xs text-slate-500">標籤必須歸屬於系統預設的四大維度之一</p>
                            </div>

                            <div className="space-y-2 relative">
                                <label className="text-sm font-medium text-slate-300">次群組名稱 (Group Name) <span className="text-slate-500 text-xs">(選填)</span></label>
                                <input
                                    type="text"
                                    placeholder="輸入或選擇現有群組..."
                                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition"
                                    value={groupName}
                                    onChange={(e) => setGroupName(e.target.value)}
                                    onFocus={() => setShowGroupSuggestions(true)}
                                    // Delay hide to allow click on suggestion
                                    onBlur={() => setTimeout(() => setShowGroupSuggestions(false), 200)}
                                />
                                {showGroupSuggestions && filteredGroups.length > 0 && (
                                    <div className="absolute top-16 w-full max-h-40 overflow-y-auto bg-slate-800 border-x border-b border-slate-700 rounded-b-lg shadow-xl z-20">
                                        {filteredGroups.map(g => (
                                            <div
                                                key={g}
                                                onClick={() => { setGroupName(g); setShowGroupSuggestions(false); }}
                                                className="px-4 py-2 text-sm text-slate-300 cursor-pointer hover:bg-teal-600/50 transition-colors"
                                            >
                                                {g}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 bg-slate-950/50 flex justify-end gap-3 border-t border-slate-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 transition"
                            disabled={isCreating}
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={isCreating || !name.trim() || !effectiveSlug}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            確認新增
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
