# AI LIB KNOWLEDGE BASE

## OVERVIEW
Core AI integration layer for medical extraction using OpenAI-compatible and Gemini providers.

## WHERE TO LOOK
| File | Purpose |
|------|---------|
| `index.ts` | Provider router. Reads `LLM_PROVIDER` and delegates to clients. |
| `openai-compatible.ts` | Large (>500 lines) client for OpenAI and local LLMs (vLLM, LM Studio). |
| `gemini.ts` | Google Gemini integration with mirrored resilience patterns. |
| `tag-prompt.ts` | Dynamic prompt builder for medical tagging. Caches tags in Redis. |
| `types.ts` | Shared Zod schemas and extraction response interfaces. |
| `__tests__/` | Vitest suites for provider logic and prompt generation. |

## CONVENTIONS
- **Health Checks**: Implement `checkServiceHealth` to verify API connectivity and model availability.
- **Vision**: Default to `gpt-5-mini` or Gemini 1.5 Pro for multi-image medical extraction.
- **Caching**: Dynamic prompt sections (like tags) use `cached()` with a 10-minute TTL.
- **Logging**: Every request must include a `traceId` and log latency/metadata.
- **Testing**: Mock all external API calls using `vi.mock` or `msw`.
- **Error Handling**: Wrap all LLM calls in try-catch blocks and return structured error objects.
- **Environment**: Use `getApiUrl()` and `getApiKey()` helpers instead of direct `process.env` access.

## ANTI-PATTERNS
- **No Direct Calls**: Don't bypass the resilience wrapper for production requests.
- **No Hardcoding**: Avoid hardcoding API keys or model names. Use the helper functions.
- **No Raw Output**: Never use LLM output without parsing through `ExtractionResponseSchema`.
- **No Blocking**: Don't block the main thread with large image payloads. Use the worker pattern if needed.
- **No Em Dashes**: Use commas or periods instead of em dashes or en dashes.
- **No Large Files**: Keep provider implementations modular. Refactor if `openai-compatible.ts` grows further.
- **No Unstructured Logs**: Always use the shared `log` utility with appropriate namespaces.
