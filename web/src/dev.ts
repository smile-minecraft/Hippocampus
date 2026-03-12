/**
 * dev.ts — Unified development orchestrator
 * 
 * Starts:
 *  1. Next.js dev server (child process)
 *  2. Parser BullMQ worker
 *  3. Explanation BullMQ worker
 *  4. Single unified Ink TUI dashboard
 * 
 * Usage: npm run dev
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { setLogSink } from "./lib/logger";
import { appendLog, setNextStatus, setWorkerMeta } from "./workers/tui/store.js";

// Wire logger → TUI store
setLogSink(({ level, service, message, timestamp, meta }) => {
    appendLog({ level, service, message, timestamp, meta });
});

// Import workers (they auto-register with BullMQ on import)
const { default: parserWorker, startParserPolling, shutdownParser } = await import("./workers/parser.worker.js");
const { default: explanationWorker, startExplanationPolling, shutdownExplanation } = await import("./workers/explanation.worker.js");

// Start queue polling for TUI
startParserPolling();
startExplanationPolling();
setWorkerMeta({ concurrency: 3, provider: process.env.LLM_PROVIDER ?? "openai" });

appendLog({ 
    level: "info", 
    service: "dev", 
    message: "Workers loaded, starting Next.js...", 
    timestamp: new Date().toISOString() 
});

// ---------------------------------------------------------------------------
// Next.js spawn
// ---------------------------------------------------------------------------

const nextProcess: ChildProcess = spawn("npx", ["next", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
    cwd: process.cwd(),
    shell: true,
});

const nextUrl = "http://localhost:3000";

function logNext(level: "info" | "warn" | "error", line: string) {
    // Filter out ANSI escape codes that would corrupt TUI
    const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
    if (!clean) return;
    
    appendLog({
        level,
        service: "next",
        message: clean,
        timestamp: new Date().toISOString(),
    });
}

nextProcess.stdout?.on("data", (buf: Buffer) => {
    const lines = buf.toString().split("\n");
    for (const line of lines) {
        if (line.includes("Ready in") || line.includes("- Local:")) {
            setNextStatus("ready", nextUrl);
            appendLog({ level: "info", service: "next", message: `Server ready at ${nextUrl}`, timestamp: new Date().toISOString() });
        } else if (line.includes("Error") || line.includes("ERROR")) {
            logNext("error", line);
        } else if (line.toLowerCase().includes("warn") || line.includes("WARN")) {
            logNext("warn", line);
        } else {
            logNext("info", line);
        }
    }
});

nextProcess.stderr?.on("data", (buf: Buffer) => {
    const lines = buf.toString().split("\n");
    for (const line of lines) {
        logNext("error", line);
    }
});

nextProcess.on("exit", (code) => {
    setNextStatus("stopped");
    appendLog({ level: "error", service: "next", message: `Next.js exited with code ${code}`, timestamp: new Date().toString() });
});

// ---------------------------------------------------------------------------
// Start TUI
// ---------------------------------------------------------------------------

async function startTui() {
    if (!process.stdout.isTTY) {
        console.log("No TTY detected, running in headless mode");
        return;
    }
    
    try {
        const React = await import("react");
        const { render } = await import("ink");
        const { default: App } = await import("./workers/tui/App.js");
        render(React.createElement(App));
    } catch (err) {
        console.error("Failed to start TUI:", err);
    }
}

void startTui();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    appendLog({ level: "info", service: "dev", message: `Received ${signal}, shutting down...`, timestamp: new Date().toISOString() });

    // Kill Next.js
    nextProcess.kill("SIGTERM");

    // Shutdown workers
    await shutdownParser(signal);
    await shutdownExplanation(signal);

    appendLog({ level: "info", service: "dev", message: "Shutdown complete", timestamp: new Date().toISOString() });
    
    setTimeout(() => process.exit(0), 500);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

appendLog({ level: "info", service: "dev", message: "Development server fully initialized", timestamp: new Date().toISOString() });
