/**
 * lib/validation/__tests__/question-format.test.ts
 *
 * Tests for question format detection utilities.
 */

import { describe, it, expect } from 'vitest';
import {
    detectOptionsInStem,
    detectQuestionNumberInExplanation,
    detectPrefixInExplanation,
    analyzeQuestionFormat,
    analyzeQuestionsFormat,
    getHighestSeverity,
    needsFormatting,
} from '../question-format';

describe('detectOptionsInStem', () => {
    it('should detect options in parenthesis format', () => {
        const stem = 'Which is false? (A) Option 1 (B) Option 2';
        expect(detectOptionsInStem(stem)).toBe(true);
    });

    it('should detect options in dot format', () => {
        const stem = 'Which is false? A. Option 1 B. Option 2';
        expect(detectOptionsInStem(stem)).toBe(true);
    });

    it('should detect single loose option', () => {
        const stem = 'Which is false? (A) Option 1';
        expect(detectOptionsInStem(stem)).toBe(true);
    });

    it('should not detect options in clean stem', () => {
        const stem = 'Which of the following is false?';
        expect(detectOptionsInStem(stem)).toBe(false);
    });

    it('should not detect options in stem with only question text', () => {
        const stem = 'During early embryonic development, what happens?';
        expect(detectOptionsInStem(stem)).toBe(false);
    });
});

describe('detectQuestionNumberInExplanation', () => {
    it('should detect Chinese question number format', () => {
        expect(detectQuestionNumberInExplanation('第122題解析：這題...')).toBe(true);
        expect(detectQuestionNumberInExplanation('第 122 題')).toBe(true);
        expect(detectQuestionNumberInExplanation('第1題')).toBe(true);
    });

    it('should detect Q-number format', () => {
        expect(detectQuestionNumberInExplanation('Q122 Answer:')).toBe(true);
        expect(detectQuestionNumberInExplanation('Q 122')).toBe(true);
        expect(detectQuestionNumberInExplanation('q122')).toBe(true);
    });

    it('should detect plain number with dot', () => {
        expect(detectQuestionNumberInExplanation('122. This is the answer')).toBe(true);
        expect(detectQuestionNumberInExplanation('122) This is the answer')).toBe(true);
    });

    it('should not detect numbers in clean explanation', () => {
        expect(detectQuestionNumberInExplanation('This is the explanation')).toBe(false);
        expect(detectQuestionNumberInExplanation('The answer is 122 because...')).toBe(false);
    });
});

describe('detectPrefixInExplanation', () => {
    it('should detect Chinese prefixes', () => {
        expect(detectPrefixInExplanation('第122題解析：')).toBe(true);
        expect(detectPrefixInExplanation('題目描述：')).toBe(true);
        expect(detectPrefixInExplanation('解析：')).toBe(true);
        expect(detectPrefixInExplanation('答案：')).toBe(true);
    });

    it('should detect English prefixes', () => {
        expect(detectPrefixInExplanation('Explanation:')).toBe(true);
        expect(detectPrefixInExplanation('Answer:')).toBe(true);
        expect(detectPrefixInExplanation('Solution:')).toBe(true);
    });

    it('should detect Q-number prefixes', () => {
        expect(detectPrefixInExplanation('Q122:')).toBe(true);
        expect(detectPrefixInExplanation('Q 122 :')).toBe(true);
    });

    it('should not detect prefixes in clean explanation', () => {
        expect(detectPrefixInExplanation('This is the explanation')).toBe(false);
    });
});

describe('analyzeQuestionFormat', () => {
    it('should return empty array for properly formatted question', () => {
        const question = {
            stem: 'Which of the following is false?',
            explanation: 'This is the explanation',
        };
        expect(analyzeQuestionFormat(question)).toHaveLength(0);
    });

    it('should detect stem with options', () => {
        const question = {
            stem: 'Which is false? (A) Option 1 (B) Option 2',
        };
        const issues = analyzeQuestionFormat(question);
        expect(issues).toHaveLength(1);
        expect(issues[0].type).toBe('stem-has-options');
        expect(issues[0].severity).toBe('error');
    });

    it('should detect explanation with question number', () => {
        const question = {
            stem: 'Clean stem',
            explanation: '第122題：This is the answer',
        };
        const issues = analyzeQuestionFormat(question);
        // Both explanation-has-number and explanation-has-prefix can be detected
        expect(issues.length).toBeGreaterThanOrEqual(1);
        expect(issues.some(i => i.type === 'explanation-has-number')).toBe(true);
        expect(issues.every(i => i.severity === 'warning')).toBe(true);
    });

    it('should detect multiple issues', () => {
        const question = {
            stem: 'Which is false? (A) Option 1',
            explanation: '解析：This is the answer',
        };
        const issues = analyzeQuestionFormat(question);
        expect(issues.length).toBeGreaterThanOrEqual(2);
        expect(issues.some(i => i.type === 'stem-has-options')).toBe(true);
        expect(issues.some(i => i.type === 'explanation-has-prefix')).toBe(true);
    });

    it('should handle null explanation', () => {
        const question = {
            stem: 'Clean stem',
            explanation: null,
        };
        expect(analyzeQuestionFormat(question)).toHaveLength(0);
    });

    it('should handle undefined explanation', () => {
        const question = {
            stem: 'Clean stem',
        };
        expect(analyzeQuestionFormat(question)).toHaveLength(0);
    });
});

describe('analyzeQuestionsFormat', () => {
    it('should analyze multiple questions', () => {
        const questions = [
            { stem: 'Clean stem 1', explanation: 'Clean explanation' },
            { stem: 'Which? (A) Opt1', explanation: '第122題' },
            { stem: 'Clean stem 3' },
        ];
        const result = analyzeQuestionsFormat(questions);
        expect(result.totalIssues).toBeGreaterThan(0);
        expect(result.questionsWithIssues).toBe(1);
        expect(result.issuesByType['stem-has-options']).toBeGreaterThan(0);
        expect(result.issuesByType['explanation-has-number']).toBeGreaterThan(0);
    });

    it('should return zero for all clean questions', () => {
        const questions = [
            { stem: 'Clean stem 1', explanation: 'Clean explanation' },
            { stem: 'Clean stem 2' },
        ];
        const result = analyzeQuestionsFormat(questions);
        expect(result.totalIssues).toBe(0);
        expect(result.questionsWithIssues).toBe(0);
    });
});

describe('getHighestSeverity', () => {
    it('should return "none" for clean question', () => {
        const question = { stem: 'Clean stem' };
        expect(getHighestSeverity(question)).toBe('none');
    });

    it('should return "error" for stem with options', () => {
        const question = { stem: 'Which? (A) Option' };
        expect(getHighestSeverity(question)).toBe('error');
    });

    it('should return "warning" for explanation with number only', () => {
        const question = { stem: 'Clean stem', explanation: '第122題' };
        expect(getHighestSeverity(question)).toBe('warning');
    });
});

describe('needsFormatting', () => {
    it('should return false for clean question', () => {
        const question = { stem: 'Clean stem' };
        expect(needsFormatting(question)).toBe(false);
    });

    it('should return true for question with issues', () => {
        const question = { stem: 'Which? (A) Option' };
        expect(needsFormatting(question)).toBe(true);
    });
});
