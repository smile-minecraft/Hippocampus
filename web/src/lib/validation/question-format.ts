/**
 * lib/validation/question-format.ts
 *
 * Question format validation utilities for detecting common AI extraction errors:
 * - Options embedded in question stem
 * - Question numbers in explanations
 * - Other formatting issues
 */

export interface FormatIssue {
    type: 'stem-has-options' | 'explanation-has-number' | 'explanation-has-prefix';
    severity: 'warning' | 'error';
    message: string;
    suggestion: string;
}

export interface QuestionToAnalyze {
    stem: string;
    explanation?: string | null;
}

// Patterns to detect options embedded in stem
const OPTION_IN_STEM_PATTERNS = [
    // (A) text (B) text pattern
    { regex: /\([A-D]\)[^\n]+\([B-D]\)/, name: 'parenthesis-options' },
    // A. text B. text pattern
    { regex: /[A-D][\.\)][^\n]+[B-D][\.\)]/, name: 'dot-options' },
    // Just (A) anywhere in stem (might be a single option left over)
    { regex: /\([A-D]\)\s+\S/, name: 'single-option' },
];

// Patterns to detect question numbers in explanation
const QUESTION_NUMBER_PATTERNS = [
    // Chinese format: 第122題, 第 122 題
    { regex: /^第\s*\d+\s*題/, name: 'chinese-number' },
    // English format: Q122, Q 122
    { regex: /^Q\s*\d+/i, name: 'q-number' },
    // Plain number with dot/paren: 122., 122)
    { regex: /^\d+\s*[\.\)]/, name: 'plain-number' },
];

// Prefixes to detect and remove from explanation
const EXPLANATION_PREFIXES = [
    // Chinese prefixes
    { regex: /^第\s*\d+\s*題[\s：:]*/i, name: '第N題' },
    { regex: /^題目[^：:]*[：:]\s*/i, name: '題目描述' },
    // English prefixes
    { regex: /^Q\s*\d+[\s：:]*/i, name: 'Q-number' },
    { regex: /^(Explanation|Answer|Solution)[\s：:]*/i, name: 'explanation-prefix' },
    // Mixed prefixes
    { regex: /^(解析|答案|說明)[\s：:]*/i, name: '解析-prefix' },
];

/**
 * Detect if options are embedded in the question stem
 */
export function detectOptionsInStem(stem: string): boolean {
    return OPTION_IN_STEM_PATTERNS.some(pattern => pattern.regex.test(stem));
}

/**
 * Detect if explanation contains question numbers
 */
export function detectQuestionNumberInExplanation(explanation: string): boolean {
    return QUESTION_NUMBER_PATTERNS.some(pattern => pattern.regex.test(explanation));
}

/**
 * Detect if explanation has prefixes that should be removed
 */
export function detectPrefixInExplanation(explanation: string): boolean {
    return EXPLANATION_PREFIXES.some(pattern => pattern.regex.test(explanation));
}

/**
 * Analyze a question for format issues
 */
export function analyzeQuestionFormat(question: QuestionToAnalyze): FormatIssue[] {
    const issues: FormatIssue[] = [];

    // Check stem for embedded options
    if (detectOptionsInStem(question.stem)) {
        issues.push({
            type: 'stem-has-options',
            severity: 'error',
            message: '題幹中檢測到選項內容',
            suggestion: '建議使用「一鍵格式化」自動分離選項',
        });
    }

    // Check explanation for question numbers
    if (question.explanation) {
        if (detectQuestionNumberInExplanation(question.explanation)) {
            issues.push({
                type: 'explanation-has-number',
                severity: 'warning',
                message: '詳解中包含題號',
                suggestion: '建議使用「一鍵格式化」自動清理題號',
            });
        }

        if (detectPrefixInExplanation(question.explanation)) {
            issues.push({
                type: 'explanation-has-prefix',
                severity: 'warning',
                message: '詳解包含多餘前綴',
                suggestion: '建議使用「一鍵格式化」移除前綴',
            });
        }
    }

    return issues;
}

/**
 * Analyze multiple questions and return summary
 */
export function analyzeQuestionsFormat(questions: QuestionToAnalyze[]): {
    totalIssues: number;
    questionsWithIssues: number;
    issuesByType: Record<string, number>;
} {
    let totalIssues = 0;
    let questionsWithIssues = 0;
    const issuesByType: Record<string, number> = {
        'stem-has-options': 0,
        'explanation-has-number': 0,
        'explanation-has-prefix': 0,
    };

    for (const question of questions) {
        const issues = analyzeQuestionFormat(question);
        if (issues.length > 0) {
            questionsWithIssues++;
            totalIssues += issues.length;
            for (const issue of issues) {
                issuesByType[issue.type]++;
            }
        }
    }

    return {
        totalIssues,
        questionsWithIssues,
        issuesByType,
    };
}

/**
 * Check if a question needs formatting
 */
export function needsFormatting(question: QuestionToAnalyze): boolean {
    return analyzeQuestionFormat(question).length > 0;
}

/**
 * Get the highest severity issue for a question
 */
export function getHighestSeverity(question: QuestionToAnalyze): 'error' | 'warning' | 'none' {
    const issues = analyzeQuestionFormat(question);
    if (issues.length === 0) return 'none';
    if (issues.some(i => i.severity === 'error')) return 'error';
    return 'warning';
}
