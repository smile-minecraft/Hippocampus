/**
 * tui/WorkerHeader.tsx — Top status bar showing worker identity and vitals.
 */

import React from "react";
import { Box, Text } from "ink";
import { useStore } from "zustand";
import { tuiStore } from "./store.js";

function formatUptime(startedAt: number): string {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${s}s`;
}

export default function WorkerHeader() {
    const workerStartedAt = useStore(tuiStore, (s) => s.workerStartedAt);
    const nextStatus = useStore(tuiStore, (s) => s.nextStatus);
    const nextUrl = useStore(tuiStore, (s) => s.nextUrl);
    const [uptime, setUptime] = React.useState(() => formatUptime(workerStartedAt));

    React.useEffect(() => {
        const timer = setInterval(() => setUptime(formatUptime(workerStartedAt)), 1000);
        return () => clearInterval(timer);
    }, [workerStartedAt]);

    const nextColor = nextStatus === "ready" ? "green" : nextStatus === "error" ? "red" : "yellow";
    const nextLabel = nextStatus === "ready" ? "READY" : nextStatus === "error" ? "ERR" : nextStatus === "starting" ? "..." : "OFF";

    return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
            <Box gap={2}>
                <Text bold color="cyan">Hippocampus</Text>
                <Text dimColor>|</Text>
                <Text>Next: <Text color={nextColor} bold>{nextLabel}</Text></Text>
                {nextUrl && <Text dimColor>{nextUrl}</Text>}
            </Box>
            <Box gap={2}>
                <Text dimColor>uptime:</Text>
                <Text>{uptime}</Text>
            </Box>
        </Box>
    );
}
