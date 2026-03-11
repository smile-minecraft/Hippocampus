import { NextResponse } from "next/server";
import { checkServiceHealth } from "@/lib/ai/openai-compatible";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const health = await checkServiceHealth();
        
        return NextResponse.json({
            healthy: health.healthy,
            latencyMs: health.latencyMs,
            model: health.configuredModel,
            availableModels: health.models ?? [],
            error: health.error,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json(
            {
                healthy: false,
                error: message,
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}
