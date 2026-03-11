/**
 * lib/ai/index.ts — AI Provider Router
 *
 * Reads `LLM_PROVIDER` env variable and delegates to the correct implementation.
 * Default: "openai" (OpenAI API).
 *
 * Re-exports shared types so consumers only need `import { ... } from "@/lib/ai"`.
 */

import { log } from "@/lib/logger";
import type {
    ExtractionResponse,
    ImageDataPart,
    LLMMeta,
    ExtractionFn,
} from "./types";

// Return type shared across all providers
export interface ServiceHealthResult {
    ready: boolean;
    attempts: number;
    finalHealth: { healthy: boolean; latencyMs?: number; error?: string };
}

// Lazy-load waitForServiceHealth — route by provider
export async function waitForServiceHealth(
    options?: Parameters<typeof import("./openai-compatible").waitForServiceHealth>[0],
): Promise<ServiceHealthResult> {
    const provider = getProvider();
    switch (provider) {
        case "openai": {
            const mod = await import("./openai-compatible");
            return mod.waitForServiceHealth(options);
        }
        case "gemini": {
            // Gemini SDK has no health endpoint — verify the API key is set
            if (!process.env.GEMINI_API_KEY) {
                return {
                    ready: false,
                    attempts: 1,
                    finalHealth: { healthy: false, error: "GEMINI_API_KEY is not set" },
                };
            }
            log.info("ai-router", "Gemini provider ready (API key present)");
            return {
                ready: true,
                attempts: 1,
                finalHealth: { healthy: true, latencyMs: 0 },
            };
        }
        case "anthropic":
            throw new Error(
                "Anthropic provider is not yet implemented. Set LLM_PROVIDER to 'openai' or 'gemini'."
            );
    }
}

// Re-export all shared types for convenience
export {
    ExtractedQuestionSchema,
    ExtractionResponseSchema,
    EmbedTaskType,
} from "./types";
export type {
    ExtractedQuestion,
    ExtractionResponse,
    ImageDataPart,
    LLMMeta,
} from "./types";

// ---------------------------------------------------------------------------
// Provider type
// ---------------------------------------------------------------------------

export type LLMProvider = "openai" | "anthropic" | "gemini";

function getProvider(): LLMProvider {
    const raw = process.env.LLM_PROVIDER ?? "openai";
    if (raw === "openai" || raw === "anthropic" || raw === "gemini") return raw;
    log.warn("ai-router", `Unknown LLM_PROVIDER "${raw}", falling back to "openai"`);
    return "openai";
}

// ---------------------------------------------------------------------------
// Lazy-loaded provider implementations
// ---------------------------------------------------------------------------

async function loadExtractionFn(provider: LLMProvider): Promise<ExtractionFn> {
    switch (provider) {
        case "openai": {
            const mod = await import("./openai-compatible");
            return mod.extractQuestionsFromImages;
        }
        case "gemini": {
            const mod = await import("./gemini");
            // Gemini returns GeminiMeta; adapt to LLMMeta
            return async (
                imageDataParts: ImageDataPart[],
                traceId: string,
                onProgress?: (message: string) => void,
            ): Promise<{ data: ExtractionResponse; meta: LLMMeta }> => {
                const { data, meta } = await mod.extractQuestionsFromImages(
                    imageDataParts,
                    traceId,
                    onProgress,
                );
                return {
                    data,
                    meta: { ...meta, provider: "gemini" },
                };
            };
        }
        case "anthropic": {
            // Anthropic support is a future extension point
            throw new Error(
                "Anthropic provider is not yet implemented. Set LLM_PROVIDER to 'openai' or 'gemini'."
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Public API — single entry point for extraction
// ---------------------------------------------------------------------------

let _cachedProvider: LLMProvider | null = null;
let _cachedFn: ExtractionFn | null = null;

/**
 * Extract structured questions from exam page images using the configured provider.
 *
 * @param imageDataParts - Array of base64 or URL image data
 * @param traceId        - Job trace ID for structured logging
 * @param onProgress     - Optional progress callback
 */
export async function extractQuestionsFromImages(
    imageDataParts: ImageDataPart[],
    traceId: string,
    onProgress?: (message: string) => void,
): Promise<{ data: ExtractionResponse; meta: LLMMeta }> {
    const provider = getProvider();

    // Cache the loaded function — env won't change at runtime
    if (_cachedProvider !== provider || !_cachedFn) {
        log.info("ai-router", `Loading AI provider: ${provider}`);
        _cachedFn = await loadExtractionFn(provider);
        _cachedProvider = provider;
    }

    return _cachedFn(imageDataParts, traceId, onProgress);
}
