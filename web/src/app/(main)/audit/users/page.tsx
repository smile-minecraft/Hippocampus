"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlertTriangle,
    ChevronDown,
    Loader2,
    Search,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Users,
} from "lucide-react";
import {
    type AdminUser,
    type AdminUserListResponse,
    fetchAdminUsers,
    updateAdminUserRole,
} from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";

const ROLE_CONFIG = {
    ADMIN: {
        label: "管理員",
        icon: ShieldAlert,
        badgeClass: "bg-danger-muted text-danger-base",
        description: "完整系統管理權限",
    },
    MODERATOR: {
        label: "審核員",
        icon: ShieldCheck,
        badgeClass: "bg-warning-muted text-warning-base",
        description: "題目審核與編輯權限",
    },
    USER: {
        label: "一般用戶",
        icon: Shield,
        badgeClass: "bg-primary-muted text-primary-base",
        description: "僅限練習與查看",
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
    const roleCounts = users.reduce<Record<string, number>>((acc, user) => {
        acc[user.role] = (acc[user.role] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="space-y-6 text-text-base">
            <PageHeader
                eyebrow="Audit / Users"
                title="用戶管理中心"
                description="管理系統用戶帳號與角色權限，並把搜尋、統計與角色調整放進同一套工作區節奏。"
                meta={(
                    <>
                        <span className="pill">第 {page} 頁</span>
                        <span className="pill">搜尋即時生效</span>
                    </>
                )}
            />

            <SectionCard title="搜尋">
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-3.5 h-4 w-4 text-text-muted" />
                    <input
                        type="text"
                        placeholder="搜尋 Email 或姓名..."
                        className="input pl-10"
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                </div>
            </SectionCard>

            {pagination ? (
                <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <SectionCard className="space-y-2">
                        <div className="text-2xl font-bold text-text-base">{pagination.total}</div>
                        <div className="text-xs text-text-muted">用戶總數</div>
                    </SectionCard>
                    {(["ADMIN", "MODERATOR", "USER"] as const).map((role) => {
                        const config = ROLE_CONFIG[role];
                        const RoleIcon = config.icon;
                        return (
                            <SectionCard key={role} className="space-y-2">
                                <div className="text-2xl font-bold text-text-base">{roleCounts[role] || 0}</div>
                                <div className="flex items-center gap-1 text-xs text-text-muted">
                                    <RoleIcon className="h-3 w-3" />
                                    {config.label} (本頁)
                                </div>
                            </SectionCard>
                        );
                    })}
                </section>
            ) : null}

            <SectionCard
                title="用戶列表"
                description="查看目前權限與作答紀錄，並在右側快速調整角色。"
                className="!p-0 overflow-hidden"
            >
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                        <thead className="border-b border-border-base bg-bg-surface/80 text-text-muted">
                            <tr>
                                <th className="px-6 py-4 font-medium">用戶</th>
                                <th className="px-6 py-4 font-medium">角色</th>
                                <th className="px-6 py-4 text-right font-medium">作答紀錄</th>
                                <th className="px-6 py-4 font-medium">註冊時間</th>
                                <th className="px-6 py-4 text-right font-medium">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-base">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                                        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                                        載入中...
                                    </td>
                                </tr>
                            ) : isError ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-danger-base">
                                        <AlertTriangle className="mx-auto mb-2 h-6 w-6 opacity-80" />
                                        取得資料失敗：{error?.message || "未授權或發生未知錯誤"}
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                                        <Users className="mx-auto mb-2 h-6 w-6 opacity-60" />
                                        沒有找到符合條件的用戶
                                    </td>
                                </tr>
                            ) : (
                                users.map((user) => {
                                    const config = ROLE_CONFIG[user.role];
                                    const RoleIcon = config.icon;

                                    return (
                                        <tr key={user.id} className="transition-colors hover:bg-bg-surface">
                                            <td className="px-6 py-3">
                                                <div>
                                                    <div className="font-medium text-text-base">
                                                        {user.name || <span className="italic text-text-muted">未設定</span>}
                                                    </div>
                                                    <div className="text-xs text-text-muted">{user.email}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.badgeClass}`}>
                                                    <RoleIcon className="h-3 w-3" />
                                                    {config.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right text-text-muted">
                                                {user._count.questionRecords}
                                            </td>
                                            <td className="px-6 py-3 text-xs text-text-muted">
                                                {new Date(user.createdAt).toLocaleDateString("zh-TW", {
                                                    year: "numeric",
                                                    month: "2-digit",
                                                    day: "2-digit",
                                                })}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <button
                                                    onClick={() => setEditingUser(user)}
                                                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition hover:bg-bg-base hover:text-text-base"
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

                {pagination && pagination.totalPages > 1 ? (
                    <div className="flex justify-center gap-2 border-t border-border-base px-6 py-4">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            className="btn-secondary disabled:opacity-50"
                        >
                            上一頁
                        </button>
                        <span className="px-3 py-2 text-sm text-text-muted">
                            {page} / {pagination.totalPages}
                        </span>
                        <button
                            disabled={page === pagination.totalPages}
                            onClick={() => setPage((current) => current + 1)}
                            className="btn-secondary disabled:opacity-50"
                        >
                            下一頁
                        </button>
                    </div>
                ) : null}
            </SectionCard>

            {editingUser ? (
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
            ) : null}
        </div>
    );
}

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
        <div className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="dialog-panel w-full max-w-md overflow-hidden border border-border-base">
                <div className="p-6">
                    <h2 className="text-xl font-bold text-text-base">變更用戶角色</h2>
                    <p className="mb-6 mt-2 text-sm text-text-muted">
                        {user.name || user.email}
                        <span className="ml-2 text-xs text-text-subtle">({user.email})</span>
                    </p>

                    <div className="space-y-2">
                        {(["USER", "MODERATOR", "ADMIN"] as const).map((role) => {
                            const config = ROLE_CONFIG[role];
                            const RoleIcon = config.icon;
                            const isSelected = selectedRole === role;
                            const isCurrent = user.role === role;

                            return (
                                <button
                                    key={role}
                                    onClick={() => setSelectedRole(role)}
                                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                                        isSelected
                                            ? "border-primary-base bg-primary-muted/40"
                                            : "border-border-base bg-bg-surface/50 hover:border-border-hover"
                                    }`}
                                >
                                    <RoleIcon className={`h-5 w-5 ${isSelected ? "text-primary-base" : "text-text-muted"}`} />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-text-base">
                                            {config.label}
                                            <span className="ml-2 text-xs text-text-subtle">{role}</span>
                                        </div>
                                        <div className="text-xs text-text-muted">{config.description}</div>
                                    </div>
                                    {isCurrent ? (
                                        <span className="rounded bg-bg-base/50 px-2 py-0.5 text-xs text-text-muted">
                                            目前
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>

                    {error ? <p className="mt-4 text-sm text-danger-base">{error}</p> : null}
                </div>

                <div className="flex justify-end gap-3 border-t border-border-base bg-bg-base/50 px-6 py-4">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted transition hover:text-text-base">
                        取消
                    </button>
                    <Button
                        disabled={!isChanged}
                        isLoading={isPending}
                        onClick={() => onConfirm(selectedRole)}
                        className="min-w-[100px] justify-center"
                    >
                        {!isPending ? "確認變更" : null}
                    </Button>
                </div>
            </div>
        </div>
    );
}
