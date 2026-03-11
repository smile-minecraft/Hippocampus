/**
 * tui/QueueStats.tsx — Compact one-line queue statistics.
 */

import React from "react";
import { Box, Text } from "ink";
import { useStore } from "zustand";
import { tuiStore } from "./store.js";

export default function QueueStats() {
    const counts = useStore(tuiStore, (s) => s.queueCounts);

    return (
        <Box paddingX={1} gap={2}>
            <Text dimColor>Queue:</Text>
            <Text>
                <Text dimColor>waiting </Text>
                <Text color="yellow" bold>{counts.waiting}</Text>
            </Text>
            <Text>
                <Text dimColor>active </Text>
                <Text color="cyan" bold>{counts.active}</Text>
            </Text>
            <Text>
                <Text dimColor>completed </Text>
                <Text color="green" bold>{counts.completed}</Text>
            </Text>
            <Text>
                <Text dimColor>failed </Text>
                <Text color={counts.failed > 0 ? "red" : undefined} bold>{counts.failed}</Text>
            </Text>
            <Text>
                <Text dimColor>delayed </Text>
                <Text bold>{counts.delayed}</Text>
            </Text>
        </Box>
    );
}
