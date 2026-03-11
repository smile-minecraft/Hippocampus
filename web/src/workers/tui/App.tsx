/**
 * tui/App.tsx — Root ink component that composes the four TUI panels.
 *
 * Layout (top to bottom):
 *   ┌──────────────────────────────────────┐
 *   │  WorkerHeader (status bar)           │
 *   ├──────────────────────────────────────┤
 *   │  ActiveJobs (progress table)         │
 *   ├──────────────────────────────────────┤
 *   │  QueueStats (one-liner)              │
 *   ├──────────────────────────────────────┤
 *   │  LogPanel (scrolling logs)           │
 *   └──────────────────────────────────────┘
 */

import React from "react";
import { Box } from "ink";
import WorkerHeader from "./WorkerHeader.js";
import ActiveJobs from "./ActiveJobs.js";
import QueueStats from "./QueueStats.js";
import LogPanel from "./LogPanel.js";

export default function App() {
    return (
        <Box flexDirection="column" width="100%">
            <WorkerHeader />
            <ActiveJobs />
            <QueueStats />
            <LogPanel />
        </Box>
    );
}
