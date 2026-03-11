/**
 * tui/ActiveJobs.tsx — Table of currently-running jobs with progress bars.
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useStore } from "zustand";
import { tuiStore, type JobState } from "./store.js";

const BAR_WIDTH = 24;

function ProgressBar({ percent }: { percent: number }) {
    const filled = Math.round((percent / 100) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    return (
        <Text>
            <Text backgroundColor="green">{" ".repeat(filled)}</Text>
            <Text dimColor>{"░".repeat(empty)}</Text>
            <Text bold> {String(percent).padStart(3)}%</Text>
        </Text>
    );
}

function elapsed(startedAt: number): string {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    return `${s}s`;
}

function JobRow({ job }: { job: JobState }) {
    const [el, setEl] = React.useState(() => elapsed(job.startedAt));

    React.useEffect(() => {
        const timer = setInterval(() => setEl(elapsed(job.startedAt)), 1000);
        return () => clearInterval(timer);
    }, [job.startedAt]);

    return (
        <Box gap={1}>
            <Box width={10}>
                <Text color="cyan">[{job.shortId}]</Text>
            </Box>
            <Box width={20}>
                <Text wrap="truncate-end">{job.filename || "unknown"}</Text>
            </Box>
            <Box width={BAR_WIDTH + 6}>
                <ProgressBar percent={job.percent} />
            </Box>
            <Box width={8}>
                <Text dimColor>{el}</Text>
            </Box>
            <Box flexGrow={1}>
                {job.percent < 100 ? (
                    <Text>
                        <Text color="green"><Spinner type="dots" /></Text>
                        {" "}{job.message}
                    </Text>
                ) : (
                    <Text color="green">{job.message}</Text>
                )}
            </Box>
        </Box>
    );
}

export default function ActiveJobs() {
    const jobs = useStore(tuiStore, (s) => s.jobs);
    const entries = Object.values(jobs);

    if (entries.length === 0) {
        return (
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>No active jobs — waiting for work...</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Header row */}
            <Box gap={1}>
                <Box width={10}><Text bold dimColor>JOB</Text></Box>
                <Box width={20}><Text bold dimColor>FILE</Text></Box>
                <Box width={BAR_WIDTH + 6}><Text bold dimColor>PROGRESS</Text></Box>
                <Box width={8}><Text bold dimColor>TIME</Text></Box>
                <Box flexGrow={1}><Text bold dimColor>STAGE</Text></Box>
            </Box>
            {entries.map((job) => (
                <JobRow key={job.id} job={job} />
            ))}
        </Box>
    );
}
