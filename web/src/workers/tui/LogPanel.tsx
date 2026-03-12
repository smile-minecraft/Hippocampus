/**
 * tui/LogPanel.tsx — Scrolling log panel showing recent structured log entries.
 */

import React from "react";
import { Box, Text } from "ink";
import { useStore } from "zustand";
import { tuiStore, type LogEntry, type LogLevel } from "./store.js";

const LEVEL_COLORS: Record<LogLevel, string | undefined> = {
    debug: "gray",
    info: "blue",
    warn: "yellow",
    error: "red",
    next: "gray",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: "DBG",
    info: "INF",
    warn: "WRN",
    error: "ERR",
    next: "NEXT",
};

const MAX_VISIBLE_LOGS = 15;

function LogLine({ entry }: { entry: LogEntry }) {
    const time = entry.timestamp.slice(11, 19);
    const color = LEVEL_COLORS[entry.level];
    const label = LEVEL_LABELS[entry.level];
    const isNext = entry.level === "next";

    return (
        <Box gap={1}>
            <Text dimColor>{time}</Text>
            <Text color={color} bold>{label}</Text>
            <Text dimColor>[{entry.service}]</Text>
            <Text wrap="truncate-end" dimColor={isNext}>{entry.message}</Text>
        </Box>
    );
}

export default function LogPanel() {
    const logs = useStore(tuiStore, (s) => s.logs);
    const [visible, setVisible] = React.useState(() => logs.slice(-MAX_VISIBLE_LOGS));

    React.useEffect(() => {
        setVisible(logs.slice(-MAX_VISIBLE_LOGS));
    }, [logs]);

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
