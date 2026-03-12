/**
 * tui/QueueStats.tsx — Compact queue statistics for both queues.
 */

import React from "react";
import { Box, Text } from "ink";
import { useStore } from "zustand";
import { tuiStore } from "./store.js";

function QueueGroup({ name, color, counts }: { name: string; color: string; counts: { waiting: number; active: number; completed: number; failed: number; delayed: number } }) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
            <Text bold color={color}>{name}</Text>
            <Box gap={2}>
                <Text dimColor>W:<Text color="yellow">{counts.waiting}</Text></Text>
                <Text dimColor>A:<Text color="cyan">{counts.active}</Text></Text>
                <Text dimColor>C:<Text color="green">{counts.completed}</Text></Text>
                <Text dimColor>F:<Text color={counts.failed > 0 ? "red" : undefined}>{counts.failed}</Text></Text>
            </Box>
        </Box>
    );
}

export default function QueueStats() {
    const queues = useStore(tuiStore, (s) => s.queues);

    return (
        <Box paddingX={1} gap={2}>
            <QueueGroup name="PARSER" color="blue" counts={queues.parser} />
            <QueueGroup name="EXPLANATION" color="magenta" counts={queues.explanation} />
        </Box>
    );
}
