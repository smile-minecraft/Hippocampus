"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Search,
    Loader2,
    AlertTriangle,
    Shield,
    ShieldCheck,
    ShieldAlert,
    Users,
    ChevronDown,
} from "lucide-react";
import {
    fetchAdminUsers,
    updateAdminUserRole,
    AdminUserListResponse,
    AdminUser,
} from "@/lib/apiClient";

const ROLE_CONFIG = {
    ADMIN: {
        label: "管理員",
        icon: ShieldAlert,
        badgeClass: "bg-red-500/15 text-red-400",
    },
    MODERATOR: {
        label: "審核員",
        icon: ShieldCheck,
        badgeClass: "bg-amber-500/15 text-amber-400",
    },
    USER: {
        label: "一般用戶",
        icon: Shield,
        badgeClass: "bg-slate-500/15 text-slate-400",
    },
} as const;

type Role = keyof typeof ROLE_CONFIG;

export default function UsersManagerPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

    const { data, isLoading, isError, error } = useQuery<AdminUserListResponse>({
        queryKey: ["admin-users", page, search],
        queryFn: () => fetchAdminUsers(page, 20, search),
        retry: 1,
    });

    const roleMutation = useMutation({
        mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
            updateAdminUserRole(userId, role),
        onSuccess: () => {
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        },
    });

    const users = data?.users ?? [];
    const pagination = data?.pagination;

    // Stats
    const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
    }, {});

    return (
        <main className="min-h-screen bg-bg-base pb-12 transition-colors duration-300">
            <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto text-slate-100">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-purple-500">
                            用戶管理中心
                        </h1>
                        <p className="text-slate-400 mt-1">
                            管理系統用戶帳號與角色權限
                        </p>
                    </div>
                </div>

                {/* Search */}
                <div className="flex gap-4 mb-6">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="搜尋 Email 或姓名..."
                            className="w-full pl-10 pr-4 py-2 bg-slate-800 border-slate-700 rounded-lg text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                    </div>
                </div>

                {/* Stats */}
                {pagination && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                            <div className="text-2xl font-bold text-slate-100">
                                {pagination.total}
                            </div>
                            <div className="text-xs text-slate-400 mt-1">
                                用戶總數
                            </div>
                        </div>
                        {(["ADMIN", "MODERATOR", "USER"] as const).map(
                            (role) => {
                                const config = ROLE_CONFIG[role];
                                return (
                                    <div
                                        key={role}
                                        className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4"
                                    >
                                        <div className="text-2xl font-bold text-slate-100">
                                            {roleCounts[role] || 0}
                                        </div>
                                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                            <config.icon className="h-3 w-3" />
                                            {config.label} (本頁)
                                        </div>
                                    </div>
                                );
                            }
                        )}
                    </div>
                )}

                {/* Table */}
                <div className="bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700">
                            <tr>
                                <th className="px-6 py-4 font-medium">
                                    用戶
                                </th>
                                <th className="px-6 py-4 font-medium">
                                    角色
                                </th>
                                <th className="px-6 py-4 font-medium text-right">
                                    作答紀錄
                                </th>
                                <th className="px-6 py-4 font-medium">
                                    註冊時間
                                </th>
                                <th className="px-6 py-4 font-medium text-right">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {isLoading ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-6 py-12 text-center text-slate-400"
                                    >
                                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                        載入中...
                                    </td>
                                </tr>
                            ) : isError ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-6 py-12 text-center text-red-400"
                                    >
                                        <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-80" />
                                        取得資料失敗：
                                        {error?.message ||
                                            "未授權或發生未知錯誤"}
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-6 py-12 text-center text-slate-400"
                                    >
                                        <Users className="h-6 w-6 mx-auto mb-2 opacity-60" />
                                        沒有找到符合條件的用戶
                                    </td>
                                </tr>
                            ) : (
                                users.map((user) => {
                                    const config = ROLE_CONFIG[user.role];
                                    const RoleIcon = config.icon;
                                    return (
                                        <tr
                                            key={user.id}
                                            className="hover:bg-slate-800 transition-colors"
                                        >
                                            <td className="px-6 py-3">
                                                <div>
                                                    <div className="font-medium text-slate-200">
                                                        {user.name || (
                                                            <span className="text-slate-500 italic">
                                                                未設定
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {user.email}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-3">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.badgeClass}`}
                                                >
                                                    <RoleIcon className="h-3 w-3" />
                                                    {config.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-300">
                                                {user._count.questionRecords}
                                            </td>
                                            <td className="px-6 py-3 text-slate-400 text-xs">
                                                {new Date(
                                                    user.createdAt
                                                ).toLocaleDateString("zh-TW", {
                                                    year: "numeric",
                                                    month: "2-digit",
                                                    day: "2-digit",
                                                })}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <button
                                                    onClick={() =>
                                                        setEditingUser(user)
                                                    }
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
                                                >
                                                    變更角色
                                                    <ChevronDown className="h-3 w-3" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="flex justify-center gap-2 pt-4">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50"
                        >
                            上一頁
                        </button>
                        <span className="px-3 py-1 text-slate-400">
                            {page} / {pagination.totalPages}
                        </span>
                        <button
                            disabled={page === pagination.totalPages}
                            onClick={() => setPage((p) => p + 1)}
                            className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50"
                        >
                            下一頁
                        </button>
                    </div>
                )}

                {/* Role Change Modal */}
                {editingUser && (
                    <RoleChangeModal
                        user={editingUser}
                        onClose={() => setEditingUser(null)}
                        onConfirm={(role) =>
                            roleMutation.mutate({
                                userId: editingUser.id,
                                role,
                            })
                        }
                        isPending={roleMutation.isPending}
                        error={roleMutation.error?.message}
                    />
                )}
            </div>
        </main>
    );
}

// ---------------------------------------------------------------------------
// Role Change Modal
// ---------------------------------------------------------------------------
function RoleChangeModal({
    user,
    onClose,
    onConfirm,
    isPending,
    error,
}: {
    user: AdminUser;
    onClose: () => void;
    onConfirm: (role: Role) => void;
    isPending: boolean;
    error?: string;
}) {
    const [selectedRole, setSelectedRole] = useState<Role>(user.role);
    const isChanged = selectedRole !== user.role;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-violet-500/30 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <h2 className="text-xl font-bold text-slate-100 mb-1">
                        變更用戶角色
                    </h2>
                    <p className="text-sm text-slate-400 mb-6">
                        {user.name || user.email}
                        <span className="text-slate-600 ml-2 text-xs">
                            ({user.email})
                        </span>
                    </p>

                    <div className="space-y-2">
                        {(["USER", "MODERATOR", "ADMIN"] as const).map(
                            (role) => {
                                const config = ROLE_CONFIG[role];
                                const Icon = config.icon;
                                const isSelected = selectedRole === role;
                                const isCurrent = user.role === role;
                                return (
                                    <button
                                        key={role}
                                        onClick={() => setSelectedRole(role)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${
                                            isSelected
                                                ? "border-violet-500 bg-violet-500/10"
                                                : "border-slate-700 hover:border-slate-600 bg-slate-800/50"
                                        }`}
                                    >
                                        <Icon
                                            className={`h-5 w-5 ${
                                                isSelected
                                                    ? "text-violet-400"
                                                    : "text-slate-500"
                                            }`}
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-slate-200">
                                                {config.label}
                                                <span className="text-slate-600 text-xs ml-2">
                                                    {role}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {role === "ADMIN" &&
                                                    "完整系統管理權限"}
                                                {role === "MODERATOR" &&
                                                    "題目審核與編輯權限"}
                                                {role === "USER" &&
                                                    "僅限練習與查看"}
                                            </div>
                                        </div>
                                        {isCurrent && (
                                            <span className="text-xs text-slate-500 px-2 py-0.5 rounded bg-slate-700/50">
                                                目前
                                            </span>
                                        )}
                                    </button>
                                );
                            }
                        )}
                    </div>

                    {error && (
                        <p className="text-sm text-red-400 mt-4">{error}</p>
                    )}
                </div>

                <div className="px-6 py-4 bg-slate-950/50 flex justify-end gap-3 border-t border-slate-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-300 hover:text-white transition"
                    >
                        取消
                    </button>
                    <button
                        disabled={!isChanged || isPending}
                        onClick={() => onConfirm(selectedRole)}
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 min-w-[100px] justify-center"
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            "確認變更"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
