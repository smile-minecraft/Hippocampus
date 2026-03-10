"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type TagDimension, type Tag } from "@/types";
import { Loader2, ChevronDown, ChevronRight, Check, Search, X } from "lucide-react";
import { fetchTags } from "@/lib/apiClient";

export interface TagFilterProps {
    selectedSlugs: string[];
    onChange: (slugs: string[]) => void;
    className?: string;
}

// Map english enums to human readable titles
const DIMENSION_LABELS: Record<TagDimension, string> = {
    ACADEMIC: "基礎學科",
    ORGAN: "臨床系統",
    EXAM_CATEGORY: "考試類別",
    META: "標籤狀態",
};

interface GroupedTag extends Tag {
    groupName?: string;
}

export function GroupedTagMultiSelect({ selectedSlugs, onChange, className = "" }: TagFilterProps) {
    const [expandedDims, setExpandedDims] = useState<Record<string, boolean>>({
        ACADEMIC: true,
        ORGAN: true,
    });
    const [searchQuery, setSearchQuery] = useState("");

    // Fetch tags via the public endpoint
    const { data: tagsData, isLoading } = useQuery({
        queryKey: ["quiz-tags"],
        queryFn: fetchTags,
        staleTime: 5 * 60 * 1000,
    });

    const tags: GroupedTag[] = useMemo(() => {
        if (!tagsData) return [];
        return tagsData.tags.map(t => ({
            ...t,
            groupName: t.category || undefined,
        }));
    }, [tagsData]);

    // Filter tags by search query (client-side)
    const filteredTags = useMemo(() => {
        if (!searchQuery.trim()) return tags;
        const q = searchQuery.toLowerCase();
        return tags.filter(tag =>
            tag.name.toLowerCase().includes(q) ||
            (tag.groupName && tag.groupName.toLowerCase().includes(q)) ||
            tag.slug.toLowerCase().includes(q)
        );
    }, [tags, searchQuery]);

    // Transform filtered tags into nested structure: Record<Dimension, Record<GroupName, Tag[]>>
    const groupedTags = useMemo(() => {
        const tree: Partial<Record<TagDimension, Record<string, GroupedTag[]>>> = {};

        filteredTags.forEach(tag => {
            const dim = tag.dimension as TagDimension | undefined;
            if (!dim) return;
            const group = tag.groupName || "其他";

            if (!tree[dim]) tree[dim] = {};
            if (!tree[dim]![group]) tree[dim]![group] = [];

            tree[dim]![group].push(tag);
        });

        return tree;
    }, [filteredTags]);

    const handleToggleTag = (slug: string) => {
        if (selectedSlugs.includes(slug)) {
            onChange(selectedSlugs.filter(s => s !== slug));
        } else {
            onChange([...selectedSlugs, slug]);
        }
    };

    const handleToggleGroup = (groupTags: GroupedTag[]) => {
        const groupSlugs = groupTags.map(t => t.slug);
        const allSelected = groupSlugs.every(s => selectedSlugs.includes(s));

        if (allSelected) {
            onChange(selectedSlugs.filter(s => !groupSlugs.includes(s)));
        } else {
            const newSlugs = new Set([...selectedSlugs, ...groupSlugs]);
            onChange(Array.from(newSlugs));
        }
    };

    const toggleDimExpand = (dim: string) => {
        setExpandedDims(prev => ({ ...prev, [dim]: !prev[dim] }));
    };

    if (isLoading) {
        return (
            <div className={`p-4 bg-bg-surface rounded-xl border border-border-base flex items-center justify-center ${className}`}>
                <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
        );
    }

    return (
        <div className={`bg-bg-surface rounded-xl border border-border-base overflow-hidden ${className}`}>
            <div className="p-3 bg-bg-base border-b border-border-base space-y-2">
                <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-text-base">
                        篩選標籤 ({selectedSlugs.length})
                    </span>
                    {selectedSlugs.length > 0 && (
                        <button
                            onClick={() => onChange([])}
                            className="text-xs text-text-muted hover:text-text-base transition"
                        >
                            清除全部
                        </button>
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-text-muted" />
                    <input
                        type="text"
                        placeholder="搜尋標籤..."
                        className="w-full pl-8 pr-8 py-1.5 bg-bg-base border border-border-base rounded-lg text-xs text-text-base placeholder-text-muted focus:border-primary-base/50 focus:ring-1 focus:ring-primary-base/30 outline-none transition"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2.5 top-2 text-text-muted hover:text-text-base transition"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto p-2 space-y-1">
                {Object.entries(groupedTags).map(([dim, groups]) => (
                    <div key={dim} className="select-none">
                        {/* Dimension Header */}
                        <div
                            className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-bg-base cursor-pointer text-text-base transition"
                            onClick={() => toggleDimExpand(dim)}
                        >
                            {expandedDims[dim] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <span className="font-semibold text-sm">{DIMENSION_LABELS[dim as TagDimension] || dim}</span>
                            <span className="text-xs text-text-muted ml-1">
                                ({Object.values(groups).reduce((sum, arr) => sum + arr.length, 0)})
                            </span>
                        </div>

                        {/* Groups */}
                        {expandedDims[dim] && (
                            <div className="pl-6 pr-2 py-1 space-y-3 border-l border-border-base ml-3.5 mb-2 mt-1">
                                {Object.entries(groups).map(([groupName, groupTags]) => {
                                    const allChecked = groupTags.every(t => selectedSlugs.includes(t.slug));
                                    const someChecked = groupTags.some(t => selectedSlugs.includes(t.slug));
                                    const indeterminate = someChecked && !allChecked;

                                    return (
                                        <div key={groupName} className="space-y-1.5">
                                            {/* Group Checkbox */}
                                            <div
                                                className="flex items-center gap-2 group cursor-pointer"
                                                onClick={() => handleToggleGroup(groupTags)}
                                            >
                                                <div className={`w-4 h-4 rounded-sm flex items-center justify-center transition-colors border
                                                    ${allChecked ? "bg-primary-base border-primary-base" :
                                                        indeterminate ? "bg-primary-base/30 border-primary-base" : "border-border-base group-hover:border-text-muted"}`}
                                                >
                                                    {allChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                                    {indeterminate && <div className="w-2 h-0.5 bg-primary-base rounded-full" />}
                                                </div>
                                                <span className="text-sm font-medium text-text-muted group-hover:text-text-base transition">
                                                    {groupName} <span className="text-xs text-text-muted ml-1">({groupTags.length})</span>
                                                </span>
                                            </div>

                                            {/* Individual Tags */}
                                            <div className="pl-6 flex flex-wrap gap-1.5 pt-0.5">
                                                {groupTags.map(tag => {
                                                    const isChecked = selectedSlugs.includes(tag.slug);
                                                    return (
                                                        <button
                                                            key={tag.slug}
                                                            onClick={() => handleToggleTag(tag.slug)}
                                                            className={`px-2 py-1 flex items-center gap-1.5 rounded text-xs transition-colors border
                                                                ${isChecked
                                                                    ? "bg-primary-base/10 shadow-sm border-primary-base/30 text-primary-base"
                                                                    : "bg-bg-surface hover:bg-bg-base text-text-muted border-border-base"
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

                {filteredTags.length === 0 && tags.length > 0 && (
                    <div className="p-4 text-center text-sm text-text-muted">
                        找不到符合「{searchQuery}」的標籤
                    </div>
                )}

                {tags.length === 0 && (
                    <div className="p-4 text-center text-sm text-text-muted">
                        目前系統中沒有可用的標籤
                    </div>
                )}
            </div>
        </div>
    );
}
