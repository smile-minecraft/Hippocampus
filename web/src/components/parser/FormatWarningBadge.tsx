/**
 * components/parser/FormatWarningBadge.tsx
 *
 * Warning badges for displaying question format issues.
 */

import React from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { FormatIssue } from '@/lib/validation/question-format';

interface FormatWarningBadgeProps {
    issue: FormatIssue;
}

export function FormatWarningBadge({ issue }: FormatWarningBadgeProps) {
    const isError = issue.severity === 'error';

    return (
        <div
            className={`
                inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
                ${isError 
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }
            `}
            title={issue.suggestion}
        >
            {isError ? (
                <AlertCircle className="w-3 h-3" />
            ) : (
                <AlertTriangle className="w-3 h-3" />
            )}
            <span>{issue.message}</span>
        </div>
    );
}

interface FormatWarningSummaryProps {
    totalIssues: number;
    questionsWithIssues: number;
    onClick?: () => void;
}

export function FormatWarningSummary({
    totalIssues,
    questionsWithIssues,
    onClick,
}: FormatWarningSummaryProps) {
    if (totalIssues === 0) return null;

    return (
        <button
            onClick={onClick}
            className="
                flex items-center gap-2 px-3 py-2 
                bg-amber-500/10 border border-amber-500/20 
                rounded-lg text-sm text-amber-400
                hover:bg-amber-500/20 transition-colors
            "
        >
            <AlertTriangle className="w-4 h-4" />
            <span>
                檢測到 {totalIssues} 個格式問題（{questionsWithIssues} 題）
            </span>
        </button>
    );
}

interface FormatIssueListProps {
    issues: FormatIssue[];
}

export function FormatIssueList({ issues }: FormatIssueListProps) {
    if (issues.length === 0) {
        return (
            <div className="text-sm text-teal-400 flex items-center gap-2">
                <span className="w-2 h-2 bg-teal-400 rounded-full"></span>
                格式正確
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-2">
            {issues.map((issue, idx) => (
                <FormatWarningBadge key={idx} issue={issue} />
            ))}
        </div>
    );
}
