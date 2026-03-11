import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
    log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// We don't mock @google/generative-ai for the OpenAI path tests.
// Gemini path tests mock it via vi.mock below.

const { mockEmbedContent } = vi.hoisted(() => ({
    mockEmbedContent: vi.fn(),
}))

vi.mock('@google/generative-ai', () => {
    class MockGoogleGenerativeAI {
        constructor(_key: string) {}
        getGenerativeModel() {
            return { embedContent: mockEmbedContent }
        }
    }
    return {
        GoogleGenerativeAI: MockGoogleGenerativeAI,
        TaskType: {
            RETRIEVAL_QUERY: 'RETRIEVAL_QUERY',
            RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT',
        },
    }
})

import {
    semanticChunk,
    cosineSimilarity,
    embed,
    embedChunks,
    EMBEDDING_DIMENSIONS,
    EmbedTaskType,
} from '../embedding'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks()
    // Default to OpenAI provider
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_URL', 'http://test-api.local/v1')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('EMBEDDING_DIMENSIONS', () => {
    it('is 1536', () => {
        expect(EMBEDDING_DIMENSIONS).toBe(1536)
    })
})

// ---------------------------------------------------------------------------
// cosineSimilarity()
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
        const v = [1, 2, 3]
        expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
    })

    it('returns 0 for orthogonal vectors', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
    })

    it('returns -1 for opposite vectors', () => {
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
    })

    it('returns 0 when either vector is all zeros', () => {
        expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    })

    it('throws when vectors have different dimensions', () => {
        expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
            'Vectors must have the same dimensionality',
        )
    })
})

// ---------------------------------------------------------------------------
// semanticChunk()
// ---------------------------------------------------------------------------

describe('semanticChunk', () => {
    it('returns empty array for empty input', () => {
        expect(semanticChunk('')).toEqual([])
    })

    it('returns empty array for whitespace-only input', () => {
        expect(semanticChunk('   \n\n   ')).toEqual([])
    })

    it('returns sequential indices starting from 0', () => {
        // Create content that produces at least 2 chunks
        const paragraphs = Array.from({ length: 10 }, (_, i) =>
            `Paragraph ${i}: ${'這是一段很長的文字用來測試分塊功能。'.repeat(20)}`
        ).join('\n\n')

        const chunks = semanticChunk(paragraphs)
        expect(chunks.length).toBeGreaterThanOrEqual(2)
        chunks.forEach((chunk, i) => {
            expect(chunk.index).toBe(i)
            expect(chunk.text).toBeTruthy()
        })
    })

    it('strips Markdown headings, bold, italic, images, links', () => {
        const md = [
            '## 標題',
            '',
            '**粗體** 與 *斜體*',
            '',
            '![圖片](http://img.png)',
            '',
            '[連結文字](http://link.com)',
        ].join('\n')

        const chunks = semanticChunk(md)
        const fullText = chunks.map((c) => c.text).join(' ')

        expect(fullText).not.toContain('##')
        expect(fullText).not.toContain('**')
        expect(fullText).not.toContain('*')
        expect(fullText).not.toContain('![')
        expect(fullText).toContain('連結文字')
        expect(fullText).not.toContain('http://link.com')
    })

    it('merges short paragraphs together', () => {
        // Very short paragraphs (well under MIN_CHUNK_TOKENS=128 ≈ 512 chars)
        const md = 'A短\n\nB短\n\nC短'
        const chunks = semanticChunk(md)
        // All three should be merged into one chunk
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toContain('A短')
        expect(chunks[0].text).toContain('C短')
    })

    it('splits oversized paragraphs on sentence boundaries', () => {
        // Create a single paragraph exceeding MAX_CHUNK_TOKENS (512 tokens ≈ 2048 chars)
        // Each sentence needs to be long enough, and there must be enough of them
        const longSentence = '這是一段非常非常長的句子包含許多字元用來測試分塊功能是否正常運作以確保品質。'
        const sentences = Array.from({ length: 40 }, (_, i) =>
            `第${i}段${longSentence.repeat(3)}`
        ).join('')

        const chunks = semanticChunk(sentences)
        expect(chunks.length).toBeGreaterThanOrEqual(2)
    })
})

// ---------------------------------------------------------------------------
// embed() — OpenAI provider path
// ---------------------------------------------------------------------------

describe('embed (OpenAI path)', () => {
    function mockFetch(embedding: number[], ok = true, status = 200): void {
        const body = ok
            ? { data: [{ embedding, index: 0 }], usage: { prompt_tokens: 10, total_tokens: 10 } }
            : 'Internal Error'

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok,
            status,
            json: async () => body,
            text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        }))
    }

    it('throws on empty string', async () => {
        await expect(embed('')).rejects.toThrow('Cannot embed an empty string')
    })

    it('throws on whitespace-only string', async () => {
        await expect(embed('   \t\n  ')).rejects.toThrow('Cannot embed an empty string')
    })

    it('calls the correct endpoint with auth header', async () => {
        const fakeVec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
        mockFetch(fakeVec)

        await embed('hello world')

        const fetchFn = vi.mocked(globalThis.fetch)
        expect(fetchFn).toHaveBeenCalledOnce()
        const [url, opts] = fetchFn.mock.calls[0]
        expect(url).toBe('http://test-api.local/v1/embeddings')
        expect(opts?.method).toBe('POST')
        expect((opts?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-key')
    })

    it('returns a vector of exactly EMBEDDING_DIMENSIONS length', async () => {
        const fakeVec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5)
        mockFetch(fakeVec)

        const result = await embed('test text')
        expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    })

    it('pads short vectors to EMBEDDING_DIMENSIONS with zeros', async () => {
        const shortVec = [0.1, 0.2, 0.3]
        mockFetch(shortVec)

        const result = await embed('test')
        expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(result[0]).toBe(0.1)
        expect(result[3]).toBe(0) // padded
    })

    it('truncates long vectors to EMBEDDING_DIMENSIONS', async () => {
        const longVec = Array.from({ length: EMBEDDING_DIMENSIONS + 100 }, () => 0.9)
        mockFetch(longVec)

        const result = await embed('test')
        expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    })

    it('throws on HTTP error', async () => {
        mockFetch([], false, 500)

        await expect(embed('test')).rejects.toThrow('HTTP 500')
    })

    it('throws on empty embedding in response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ embedding: [], index: 0 }] }),
        }))

        await expect(embed('test')).rejects.toThrow('empty embedding vector')
    })

    it('throws on network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

        await expect(embed('test')).rejects.toThrow('Failed to connect')
    })

    it('omits Authorization header when no API key is set', async () => {
        vi.stubEnv('OPENAI_API_KEY', '')
        const fakeVec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
        mockFetch(fakeVec)

        await embed('test')

        const fetchFn = vi.mocked(globalThis.fetch)
        const headers = fetchFn.mock.calls[0][1]?.headers as Record<string, string>
        expect(headers['Authorization']).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// embed() — Gemini provider path
// ---------------------------------------------------------------------------

describe('embed (Gemini path)', () => {
    beforeEach(() => {
        vi.stubEnv('LLM_PROVIDER', 'gemini')
        vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    })

    it('throws when GEMINI_API_KEY is missing', async () => {
        vi.stubEnv('GEMINI_API_KEY', '')
        await expect(embed('test', EmbedTaskType.RETRIEVAL_DOCUMENT)).rejects.toThrow(
            'GEMINI_API_KEY is not set',
        )
    })

    it('returns padded vector when Gemini returns fewer dimensions', async () => {
        mockEmbedContent.mockResolvedValueOnce({
            embedding: { values: [0.1, 0.2, 0.3] },
        })

        const result = await embed('test text', EmbedTaskType.RETRIEVAL_DOCUMENT)
        expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(result[0]).toBe(0.1)
        expect(result[3]).toBe(0) // padded
    })
})

// ---------------------------------------------------------------------------
// embedChunks()
// ---------------------------------------------------------------------------

describe('embedChunks', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('embeds each chunk sequentially and returns indexed results', async () => {
        const fakeVec = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i * 0.001)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ embedding: fakeVec, index: 0 }] }),
        }))

        const chunks = [
            { index: 0, text: '第一段' },
            { index: 1, text: '第二段' },
        ]

        // Run embedChunks but advance timers for the 100ms delays
        const promise = embedChunks(chunks)
        // Advance for the first setTimeout(100ms) between chunks
        await vi.advanceTimersByTimeAsync(200)
        const results = await promise

        expect(results).toHaveLength(2)
        expect(results[0].index).toBe(0)
        expect(results[1].index).toBe(1)
        expect(results[0].vector).toHaveLength(EMBEDDING_DIMENSIONS)
    })

    it('returns empty array for empty input', async () => {
        const results = await embedChunks([])
        expect(results).toEqual([])
    })
})
