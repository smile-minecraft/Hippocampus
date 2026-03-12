/**
 * lib/validation/question-formatter.ts
 *
 * Automatic question formatting utilities to fix common AI extraction errors.
 */

export interface FormattedQuestion {
    stem: string;
    options: Record<string, string>;
    explanation?: string | null;
}

export interface QuestionToFormat {
    stem: string;
    options: Record<string, string>;
    explanation?: string | null;
}

export interface FormatResult {
    question: FormattedQuestion;
    changes: string[];
    hasChanges: boolean;
}

// Explanation prefix patterns to remove
const EXPLANATION_PREFIX_PATTERNS = [
    /^第\s*\d+\s*題[\s：:]*/i,           // 第122題：, 第 1 題：
    /^題目[^：:\n]*[：:]\s*/i,            // 題目描述：
    /^Q\s*\d+\s*[：:]\s*/i,               // Q122:, Q 122:
    /^(Explanation|Solution)[\s：:]\s*/i, // Explanation:
    /^(解析|答案|說明)[\s：:]\s*/i,        // 解析：
];

// Option patterns in stem (for extraction)
const OPTION_PATTERNS = {
    // (A) text (B) text (C) text (D) text
    parenthesis: /\(([A-D])\)\s*([^\n]*?)(?=\s*\([B-D]\)|\s*$)/g,
    // A. text B. text C. text D. text
    dot: /([A-D])[\.\)]\s*([^\n]*?)(?=\s*[B-D][\.\)]|\s*$)/g,
    // Loose match - just find (A) ... patterns
    loose: /\(([A-D])\)\s*(.+?)(?=\s*\([B-D]\)|\s*$)/g,
};

/**
 * Clean explanation by removing question numbers and prefixes
 */
export function cleanExplanation(explanation: string): string {
    let cleaned = explanation.trim();

    // Remove prefixes one by one
    for (const pattern of EXPLANATION_PREFIX_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.trim();
}

/**
 * Extract options from stem text
 * Returns the cleaned stem and extracted options
 */
export function extractOptionsFromStem(
    stem: string,
    existingOptions: Record<string, string>
): { stem: string; extractedOptions: Record<string, string> } {
    let cleanStem = stem;
    const extractedOptions: Record<string, string> = { ...existingOptions };
    const foundOptions = new Map<string, string>();

    // Try to match (A) pattern first
    let match;
    const parenthesisRegex = new RegExp(OPTION_PATTERNS.parenthesis.source, 'g');

    while ((match = parenthesisRegex.exec(stem)) !== null) {
        const [, key, value] = match;
        if (key && value && ['A', 'B', 'C', 'D'].includes(key)) {
            foundOptions.set(key, value.trim());
        }
    }

    // If no parenthesis matches, try dot pattern
    if (foundOptions.size === 0) {
        const dotRegex = new RegExp(OPTION_PATTERNS.dot.source, 'g');
        while ((match = dotRegex.exec(stem)) !== null) {
            const [, key, value] = match;
            if (key && value && ['A', 'B', 'C', 'D'].includes(key)) {
                foundOptions.set(key, value.trim());
            }
        }
    }

    // If still no matches, try loose pattern
    if (foundOptions.size === 0) {
        const looseRegex = new RegExp(OPTION_PATTERNS.loose.source, 'g');
        while ((match = looseRegex.exec(stem)) !== null) {
            const [, key, value] = match;
            if (key && value && ['A', 'B', 'C', 'D'].includes(key)) {
                foundOptions.set(key, value.trim());
            }
        }
    }

    // Merge extracted options with existing (prefer extracted if not empty)
    for (const [key, value] of foundOptions) {
        if (value && value.length > 0) {
            extractedOptions[key] = value;
        }
    }

    // Remove option patterns from stem
    // First, remove the matched option patterns
    cleanStem = cleanStem.replace(/\s*\([A-D]\)[^\n]+(?=\s*\([B-D]\)|\s*$)/g, '');
    cleanStem = cleanStem.replace(/\s*[A-D][\.\)][^\n]+(?=\s*[B-D][\.\)]|\s*$)/g, '');

    // Clean up any remaining loose patterns at the end
    cleanStem = cleanStem.replace(/\s*\([A-D]\).*$/, '');
    cleanStem = cleanStem.replace(/\s*[A-D][\.\)].*$/, '');

    // Trim and clean up
    cleanStem = cleanStem.trim();

    // Remove trailing punctuation if it's a question mark (keep it) or remove extra spaces
    cleanStem = cleanStem.replace(/\s+$/g, '');

    return { stem: cleanStem, extractedOptions };
}

/**
 * Check if stem contains embedded options
 */
export function hasEmbeddedOptions(stem: string): boolean {
    const hasParenthesis = /\([A-D]\)[^\n]+\([B-D]\)/.test(stem);
    const hasDot = /[A-D][\.\)][^\n]+[B-D][\.\)]/.test(stem);
    const hasLoose = /\([A-D]\)\s*\S/.test(stem);
    return hasParenthesis || hasDot || hasLoose;
}

/**
 * Check if explanation needs cleaning
 */
export function needsExplanationCleaning(explanation: string): boolean {
    return EXPLANATION_PREFIX_PATTERNS.some(pattern => pattern.test(explanation));
}

/**
 * Format a single question
 */
export function formatQuestion(question: QuestionToFormat): FormatResult {
    const changes: string[] = [];
    const result: FormattedQuestion = {
        stem: question.stem,
        options: { ...question.options },
        explanation: question.explanation,
    };

    // 1. Fix stem with embedded options
    if (hasEmbeddedOptions(question.stem)) {
        const { stem: cleanStem, extractedOptions } = extractOptionsFromStem(
            question.stem,
            question.options
        );

        if (cleanStem !== question.stem) {
            result.stem = cleanStem;
            changes.push(`從題幹中分離選項 (${Object.keys(extractedOptions).length} 個)`);
        }

        // Merge extracted options
        for (const [key, value] of Object.entries(extractedOptions)) {
            if (value && value.length > 0 && (!result.options[key] || result.options[key].length === 0)) {
                result.options[key] = value;
                changes.push(`提取選項 ${key}: "${value.substring(0, 30)}${value.length > 30 ? '...' : ''}"`);
            }
        }
    }

    // 2. Clean explanation
    if (question.explanation && needsExplanationCleaning(question.explanation)) {
        const cleanExp = cleanExplanation(question.explanation);
        if (cleanExp !== question.explanation) {
            result.explanation = cleanExp;
            changes.push('清理詳解中的題號和前綴');
        }
    }

    return {
        question: result,
        changes,
        hasChanges: changes.length > 0,
    };
}

/**
 * Format multiple questions
 */
export function formatQuestions(questions: QuestionToFormat[]): {
    questions: FormattedQuestion[];
    summary: {
        totalFormatted: number;
        totalChanges: number;
        changesByType: Record<string, number>;
    };
} {
    const formatted: FormattedQuestion[] = [];
    let totalFormatted = 0;
    let totalChanges = 0;
    const changesByType: Record<string, number> = {
        'stem-options': 0,
        'explanation-prefix': 0,
    };

    for (const question of questions) {
        const result = formatQuestion(question);
        formatted.push(result.question);

        if (result.hasChanges) {
            totalFormatted++;
            totalChanges += result.changes.length;

            // Categorize changes
            for (const change of result.changes) {
                if (change.includes('題幹') || change.includes('選項')) {
                    changesByType['stem-options']++;
                } else if (change.includes('詳解') || change.includes('前綴')) {
                    changesByType['explanation-prefix']++;
                }
            }
        }
    }

    return {
        questions: formatted,
        summary: {
            totalFormatted,
            totalChanges,
            changesByType,
        },
    };
}

/**
 * Preview formatting changes without applying them
 */
export function previewFormatChanges(
    question: QuestionToFormat
): { original: QuestionToFormat; formatted: FormattedQuestion; changes: string[] } {
    const result = formatQuestion(question);
    return {
        original: question,
        formatted: result.question,
        changes: result.changes,
    };
}
