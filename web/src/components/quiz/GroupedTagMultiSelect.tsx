"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type TagDimension, type Tag } from "@prisma/client";
import { Loader2, ChevronDown, ChevronRight, Check } from "lucide-react";
import { fetchApi } from "@/lib/apiClient";

export interface TagFilterProps {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    className?: string;
}

// Map english enums to human readable titles
const DIMENSION_LABELS: Record<TagDimension, string> = {
    ACADEMIC: "基礎學科",
    ORGAN: "臨床系統",
    EXAM_CATEGORY: "考試類別",
    META: "標籤狀態",
};

export function GroupedTagMultiSelect({ selectedIds, onChange, className = "" }: TagFilterProps) {
    const [expandedDims, setExpandedDims] = useState<Record<string, boolean>>({
        ACADEMIC: true,
        ORGAN: true,
    });

    // Fetch flat list of public tags
    const { data: tags = [], isLoading } = useQuery<Tag[]>({
        queryKey: ["quiz-tags"],
        queryFn: async () => {
            const res = await fetchApi<{ tags: Tag[] }>("/api/tags");
            return res.tags;
        },
        staleTime: 5 * 60 * 1000 // Cache for 5 mins
    });

    // Transform flat tags into nested structure: Record<Dimension, Record<GroupName, Tag[]>>
    const groupedTags = useMemo(() => {
        const tree: Partial<Record<TagDimension, Record<string, Tag[]>>> = {};

        tags.forEach(tag => {
            const dim = tag.dimension as TagDimension;
            const group = tag.groupName || "其他";

            if (!tree[dim]) tree[dim] = {};
            if (!tree[dim]![group]) tree[dim]![group] = [];

            tree[dim]![group].push(tag);
        });

        return tree;
    }, [tags]);

    const handleToggleTag = (tagId: string) => {
        if (selectedIds.includes(tagId)) {
            onChange(selectedIds.filter(id => id !== tagId));
        } else {
            onChange([...selectedIds, tagId]);
        }
    };

    const handleToggleGroup = (groupTags: Tag[]) => {
        const groupIds = groupTags.map(t => t.id);
        const allSelected = groupIds.every(id => selectedIds.includes(id));

        if (allSelected) {
            // Remove all
            onChange(selectedIds.filter(id => !groupIds.includes(id)));
        } else {
            // Add missing
            const newIds = new Set([...selectedIds, ...groupIds]);
            onChange(Array.from(newIds));
        }
    };

    const toggleDimExpand = (dim: string) => {
        setExpandedDims(prev => ({ ...prev, [dim]: !prev[dim] }));
    };

    if (isLoading) {
        return (
            <div className={`p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 flex items-center justify-center ${className}`}>
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className={`bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden ${className}`}>
            <div className="p-3 bg-slate-800/80 border-b border-slate-700/50 font-medium text-sm text-slate-200">
                篩選標籤 ({selectedIds.length})
            </div>

            <div className="max-h-[400px] overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {Object.entries(groupedTags).map(([dim, groups]) => (
                    <div key={dim} className="select-none">
                        {/* Dimension Header */}
                        <div
                            className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-slate-700/30 cursor-pointer text-slate-300 transition"
                            onClick={() => toggleDimExpand(dim)}
                        >
                            {expandedDims[dim] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <span className="font-semibold text-sm">{DIMENSION_LABELS[dim as TagDimension] || dim}</span>
                        </div>

                        {/* Groups */}
                        {expandedDims[dim] && (
                            <div className="pl-6 pr-2 py-1 space-y-3 border-l border-slate-700/50 ml-3.5 mb-2 mt-1">
                                {Object.entries(groups).map(([groupName, groupTags]) => {
                                    const allChecked = groupTags.every(t => selectedIds.includes(t.id));
                                    const someChecked = groupTags.some(t => selectedIds.includes(t.id));
                                    const indeterminate = someChecked && !allChecked;

                                    return (
                                        <div key={groupName} className="space-y-1.5">
                                            {/* Group Checkbox */}
                                            <div
                                                className="flex items-center gap-2 group cursor-pointer"
                                                onClick={() => handleToggleGroup(groupTags)}
                                            >
                                                <div className={`w-4 h-4 rounded-sm flex items-center justify-center transition-colors border
                                                    ${allChecked ? "bg-teal-500 border-teal-500" :
                                                        indeterminate ? "bg-teal-500/30 border-teal-500" : "border-slate-600 group-hover:border-slate-400"}`}
                                                >
                                                    {allChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                                    {indeterminate && <div className="w-2 h-0.5 bg-teal-400 rounded-full" />}
                                                </div>
                                                <span className="text-sm font-medium text-slate-400 group-hover:text-slate-300 transition">
                                                    {groupName} <span className="text-xs text-slate-500 ml-1">({groupTags.length})</span>
                                                </span>
                                            </div>

                                            {/* Individual Tags */}
                                            <div className="pl-6 flex flex-wrap gap-1.5 pt-0.5">
                                                {groupTags.map(tag => {
                                                    const isChecked = selectedIds.includes(tag.id);
                                                    return (
                                                        <button
                                                            key={tag.id}
                                                            onClick={() => handleToggleTag(tag.id)}
                                                            className={`px-2 py-1 flex items-center gap-1.5 rounded text-xs transition-colors border
                                                                ${isChecked
                                                                    ? "bg-teal-500/20 shadow-sm border-teal-500/30 text-teal-300"
                                                                    : "bg-slate-800/50 hover:bg-slate-700 text-slate-400 border-slate-700"
                                                                }`}
                                                        >
                                                            {tag.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}

                {tags.length === 0 && (
                    <div className="p-4 text-center text-sm text-slate-500">
                        目前系統中沒有可用的標籤
                    </div>
                )}
            </div>
        </div>
    );
}
