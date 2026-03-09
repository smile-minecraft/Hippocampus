import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractQuestionsFromImages } from '../gemini';
import { ZodError } from 'zod';

const { mockGenerateContent } = vi.hoisted(() => {
    return { mockGenerateContent: vi.fn() };
});

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: class {
        constructor() { }
        getGenerativeModel() {
            return {
                generateContent: mockGenerateContent,
            };
        }
    },
    SchemaType: {
        OBJECT: "OBJECT",
        ARRAY: "ARRAY",
        STRING: "STRING",
        INTEGER: "INTEGER"
    }
}));

describe('Gemini AI Parser - extraction resilience and edge cases', () => {
    const DUMMY_IMAGES = [{ type: 'base64' as const, mimeType: 'image/png', data: 'dummy' }];
    const TRACE_ID = 'test-trace-123';

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GEMINI_API_KEY = "dummy-key";
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('1. Perfect Case: Parses natively structured valid JSON correctly', async () => {
        const perfectResponse = {
            questions: [
                {
                    stem: "What is the capital of France?",
                    options: { A: "Paris", B: "London", C: "Berlin", D: "Madrid" },
                    answer: "A",
                    explanation: "Paris is the capital."
                }
            ],
            metadata: { year: 2023, examType: "test", pageCount: 1 }
        };

        mockGenerateContent.mockResolvedValueOnce({
            response: {
                text: () => JSON.stringify(perfectResponse),
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
            }
        });

        const { data, meta } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe("What is the capital of France?");
        expect(meta.promptTokenCount).toBe(10);
    });

    it('2. Naked Array Case: Auto-heals by wrapping array in object and generating metadata', async () => {
        // AI directly returns an array of questions without wrapping in { questions: [] }
        const nakedArrayResponse = [
            {
                stem: "Auto-healed Naked Array",
                options: { A: "1", B: "2", C: "3", D: "4" },
                answer: "B"
            }
        ];

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => JSON.stringify(nakedArrayResponse) }
        });

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe("Auto-healed Naked Array");
        expect(data.metadata.examType).toBe("自動修正");
        expect(data.metadata.pageCount).toBe(1); // 1 image part passed
    });

    it('3. Wrapped Array Case: Auto-heals double wrapping [{ questions: [...] }]', async () => {
        // AI double wraps the correct object inside an array
        const wrappedArrayResponse = [
            {
                questions: [{
                    stem: "Auto-healed Wrapped Array",
                    options: { A: "1", B: "2", C: "3", D: "4" },
                    answer: "C"
                }],
                metadata: { year: 2024, examType: "outer", pageCount: 5 }
            }
        ];

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => JSON.stringify(wrappedArrayResponse) }
        });

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].stem).toBe("Auto-healed Wrapped Array");
        expect(data.metadata.examType).toBe("outer");
    });

    it('4. Missing Optional Case: Does not throw when explanation is missing or null', async () => {
        const noExplanationResponse = {
            questions: [
                {
                    stem: "Missing Explanation",
                    options: { A: "ok", B: "ok", C: "ok", D: "ok" },
                    answer: "A",
                    explanation: null // Should not fail since we allowed nullish()
                }
            ],
            metadata: { year: 2023, examType: "test", pageCount: 1 }
        };

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => JSON.stringify(noExplanationResponse) }
        });

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);
        expect(data.questions[0].explanation).toBeNull();
    });

    it('5. Unknown Properties Case: Zod strips hallucinated JSON fields from payload', async () => {
        const hallucinatedResponse = {
            someWeirdProperty: "AI is hallucinating",
            questions: [
                {
                    stem: "Stem content",
                    garbageField: "Not in schema",
                    options: { A: "ok", B: "ok", C: "ok", D: "ok" },
                    answer: "A"
                }
            ],
            metadata: { year: 2023, examType: "test", pageCount: 1, extraThing: 999 }
        };

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => JSON.stringify(hallucinatedResponse) }
        });

        const { data } = await extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);

        // Use type assertion to silence TS checking properties that shouldn't exist
        expect((data as any).someWeirdProperty).toBeUndefined();
        expect((data.questions[0] as any).garbageField).toBeUndefined();
        expect((data.metadata as any).extraThing).toBeUndefined();
    });

    it('6. Physical Truncation Case: Safely throws custom JSON parse failure instead of hard crash', async () => {
        const truncatedJsonString = `{ "questions": [ { "stem": "Incomplet`;

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => truncatedJsonString } // SyntaxError
        });

        // App should not crash. Instead, our wrapper should catch and format this error.
        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow('Gemini JSON parse failure');
    });

    it('7. Invalid Shape Case: Zod correctly rejects missing strictly required fields (Fail-Fast)', async () => {
        const missingOptionsResponse = {
            questions: [
                {
                    stem: "Missing Options block entirely",
                    answer: "A"
                }
            ],
            metadata: { year: 2023, examType: "test", pageCount: 1 }
        };

        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => JSON.stringify(missingOptionsResponse) }
        });

        await expect(extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID))
            .rejects
            .toThrow(ZodError);
    });

    describe('Network Failure & Circuit Breaker', () => {
        beforeEach(() => {
            vi.useFakeTimers(); // Intercept Cockatiel setTimeout
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('8. Throws network error after Cockatiel Exponential Backoff retries fail', async () => {
            // Mock API to always throw an error
            mockGenerateContent.mockRejectedValue(new Error("503 Service Unavailable"));

            const promise = extractQuestionsFromImages(DUMMY_IMAGES, TRACE_ID);

            // Fast-forward Cockatiel retry delays safely
            const advanceTimers = async () => {
                for (let i = 0; i < 5; i++) {
                    await vi.runAllTimersAsync();
                }
            };

            // Advance timers in parallel with the failing network request
            await expect(Promise.all([promise, advanceTimers()])).rejects.toThrow("503 Service Unavailable");

            // Cockatiel should have attempted it multiple times (initial + retries)
            expect(mockGenerateContent.mock.calls.length).toBeGreaterThan(1);
        });
    });
});
