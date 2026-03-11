/**
 * tui/LogPanel.tsx — Scrolling log panel showing recent structured log entries.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { useStore } from "zustand";
import { tuiStore, type LogEntry, type LogLevel } from "./store.js";

const LEVEL_COLORS: Record<LogLevel, string | undefined> = {
    debug: "gray",
    info: "blue",
    warn: "yellow",
    error: "red",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: "DBG",
    info: "INF",
    warn: "WRN",
    error: "ERR",
};

function LogLine({ entry }: { entry: LogEntry }) {
    const time = entry.timestamp.slice(11, 19); // HH:mm:ss
    const color = LEVEL_COLORS[entry.level];
    const label = LEVEL_LABELS[entry.level];

    return (
        <Box gap={1}>
            <Text dimColor>{time}</Text>
            <Text color={color} bold>{label}</Text>
            <Text dimColor>[{entry.service}]</Text>
            <Text wrap="truncate-end">{entry.message}</Text>
        </Box>
    );
}

export default function LogPanel() {
    const logs = useStore(tuiStore, (s) => s.logs);
    const { stdout } = useStdout();

    // Reserve roughly half the terminal height for logs, minimum 6 lines
    const termHeight = stdout?.rows ?? 24;
    const maxVisible = Math.max(6, Math.floor(termHeight / 2) - 2);
    const visible = logs.slice(-maxVisible);

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
            <Text bold dimColor>
                {"─ Logs "}{"─".repeat(60)}
            </Text>
            {visible.length === 0 ? (
                <Text dimColor>No log entries yet.</Text>
            ) : (
                visible.map((entry, i) => <LogLine key={i} entry={entry} />)
            )}
        </Box>
    );
}
