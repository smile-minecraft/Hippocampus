import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Mock: intercept global fetch to simulate the OpenAI-compatible API
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

// We must import AFTER mocking fetch so the module picks it up
const { extractQuestionsFromImages } = await import('../openai-compatible');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOAIResponse(content: object | string, opts?: {
    finishReason?: string;
    promptTokens?: number;
    completionTokens?: number;
}) {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return {
        ok: true,
        status: 200,
        json: async () => ({
            id: 'chatcmpl-test',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: opts?.finishReason ?? 'stop',
            }],
            usage: {
                prompt_tokens: opts?.promptTokens ?? 100,
                completion_tokens: opts?.completionTokens ?? 50,
                total_tokens: (opts?.promptTokens ?? 100) + (opts?.completionTokens ?? 50),
            },
        }),
    };
}

describe('OpenAI-Compatible AI Parser — extraction resilience and edge cases', () => {
    const DUMMY_IMAGES = [{ type: 'base64' as const, mimeType: 'image/png', data: 'dW1teQ==' }];
    const TRACE_ID = 'test-oai-trace-123';

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.OPENAI_API_URL = 'http://127.0.0.1:8000/v1';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.OPENAI_VISION_MODEL = 'test-model';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('1. Perfect Case: Parses valid JSON response correctly', async () => {
        const perfectResponse = {
            questions: [{
                stem: 'What is the capital of France?',
                options: { A: 'Paris', B: 'London', C: 'Berlin', D: 'Madrid' },
                answer: 'A',
                explanation: 'Paris is the capital.',
            }],
            metadata: { year: 2024, examType: 'test', pageCount: 1 },
        };

        mockFetch.mockResolvedValueOnce(makeOAIResponse(perfectResponse));

        const { data, meta } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe('What is the capital of France?');
        expect(meta.provider).toBe('openai');
        expect(meta.promptTokenCount).toBe(100);
    });

    it('2. Naked Array Case: Auto-heals by wrapping array in object', async () => {
        const nakedArray = [{
            stem: 'Naked Array Question',
            options: { A: '1', B: '2', C: '3', D: '4' },
            answer: 'B',
        }];

        mockFetch.mockResolvedValueOnce(makeOAIResponse(nakedArray));

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe('Naked Array Question');
        expect(data.metadata.examType).toBe('自動修正');
        expect(data.metadata.pageCount).toBe(1);
    });

    it('3. Wrapped Array Case: Auto-heals [{ questions: [...] }]', async () => {
        const wrappedArray = [{
            questions: [{
                stem: 'Wrapped Array Question',
                options: { A: '1', B: '2', C: '3', D: '4' },
                answer: 'C',
            }],
            metadata: { year: 2025, examType: 'wrapped', pageCount: 3 },
        }];

        mockFetch.mockResolvedValueOnce(makeOAIResponse(wrappedArray));

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe('Wrapped Array Question');
        expect(data.metadata.examType).toBe('wrapped');
    });

    it('4. Markdown Fence Case: Strips ```json fences from response', async () => {
        const fencedJson = '```json\n' + JSON.stringify({
            questions: [{
                stem: 'Fenced Question',
                options: { A: 'a', B: 'b', C: 'c', D: 'd' },
                answer: 'A',
            }],
            metadata: { pageCount: 1 },
        }) + '\n```';

        mockFetch.mockResolvedValueOnce(makeOAIResponse(fencedJson));

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe('Fenced Question');
    });

    it('5. Missing Optional Case: Does not throw when explanation is null', async () => {
        const response = {
            questions: [{
                stem: 'No Explanation',
                options: { A: 'ok', B: 'ok', C: 'ok', D: 'ok' },
                answer: 'A',
                explanation: null,
            }],
            metadata: { year: 2024, examType: 'test', pageCount: 1 },
        };

        mockFetch.mockResolvedValueOnce(makeOAIResponse(response));

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions[0].explanation).toBeNull();
    });

    it('6. Unknown Properties Case: Zod strips hallucinated fields', async () => {
        const response = {
            hallucination: 'should be stripped',
            questions: [{
                stem: 'Clean Stem',
                garbage: 'not in schema',
                options: { A: 'ok', B: 'ok', C: 'ok', D: 'ok' },
                answer: 'A',
            }],
            metadata: { year: 2024, examType: 'test', pageCount: 1, extraThing: 999 },
        };

        mockFetch.mockResolvedValueOnce(makeOAIResponse(response));

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect((data as Record<string, unknown>).hallucination).toBeUndefined();
        expect((data.questions[0] as Record<string, unknown>).garbage).toBeUndefined();
    });

    it('7. Truncated JSON Case: Throws JSON parse failure', async () => {
        const truncated = '{ "questions": [ { "stem": "Incomplet';

        mockFetch.mockResolvedValueOnce(makeOAIResponse(truncated));

        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow('OpenAI-compatible JSON parse failure');
    });

    it('8. Invalid Shape Case: Zod rejects missing required fields', async () => {
        const missingOptions = {
            questions: [{
                stem: 'Missing Options',
                answer: 'A',
            }],
            metadata: { year: 2024, examType: 'test', pageCount: 1 },
        };

        mockFetch.mockResolvedValueOnce(makeOAIResponse(missingOptions));

        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow(ZodError);
    });

    it('9. HTTP Error Case: Throws on non-200 response', { timeout: 30_000 }, async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
        });

        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow('HTTP 503');
    });

    it('10. Empty Content Case: Throws on empty response body', { timeout: 30_000 }, async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                id: 'chatcmpl-empty',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: '' },
                    finish_reason: 'stop',
                }],
            }),
        });

        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow('empty response');
    });

    it('11. Meta includes correct provider and model info', async () => {
        const response = {
            questions: [{
                stem: 'Meta Test',
                options: { A: 'a', B: 'b', C: 'c', D: 'd' },
                answer: 'D',
            }],
            metadata: { pageCount: 2 },
        };

        mockFetch.mockResolvedValueOnce(makeOAIResponse(response, {
            promptTokens: 500,
            completionTokens: 200,
        }));

        const { meta } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(meta.provider).toBe('openai');
        expect(meta.model).toBe('test-model');
        expect(meta.promptTokenCount).toBe(500);
        expect(meta.candidatesTokenCount).toBe(200);
        expect(meta.imageCount).toBe(1);
        expect(meta.questionCount).toBe(1);
    });
});
