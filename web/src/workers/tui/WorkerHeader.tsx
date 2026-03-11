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
    const { workerStartedAt, concurrency, provider } = useStore(tuiStore);
    const [uptime, setUptime] = React.useState(() => formatUptime(workerStartedAt));

    React.useEffect(() => {
        const timer = setInterval(() => setUptime(formatUptime(workerStartedAt)), 1000);
        return () => clearInterval(timer);
    }, [workerStartedAt]);

    return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
            <Text bold color="cyan">
                Hippocampus Worker
            </Text>
            <Box gap={2}>
                <Text>
                    <Text dimColor>provider:</Text> <Text color="green">{provider}</Text>
                </Text>
                <Text>
                    <Text dimColor>concurrency:</Text> <Text color="yellow">{concurrency}</Text>
                </Text>
                <Text>
                    <Text dimColor>uptime:</Text> <Text>{uptime}</Text>
                </Text>
            </Box>
        </Box>
    );
}
