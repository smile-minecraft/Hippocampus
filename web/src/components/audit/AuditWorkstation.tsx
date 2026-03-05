'use client'

import { useState } from 'react'
import { DraftEditor } from './DraftEditor'
import { cn } from '@/lib/cn'
import { CheckCircle, FileImage } from 'lucide-react'

interface AuditTask {
    id: string
    imageUrl: string
    questionId: string
    placeholder: string
    status: 'pending' | 'done'
}

// Placeholder tasks — in production, these come from Agent B's API
const DEMO_TASKS: AuditTask[] = [
    {
        id: '1',
        imageUrl: '/placeholder-audit.png',
        questionId: 'demo-question-id',
        placeholder: '[需要手動截圖_1]',
        status: 'pending',
    },
]

/**
 * AuditWorkstation — full two-pane audit UI.
 * Left: task list / image source browser
 * Right: DraftEditor with ImageCropCanvas
 */
export function AuditWorkstation() {
    const [tasks, setTasks] = useState<AuditTask[]>(DEMO_TASKS)
    const [activeId, setActiveId] = useState<string>(DEMO_TASKS[0]?.id ?? '')

    const activeTask = tasks.find((t) => t.id === activeId)

    const handleBound = (taskId: string) => {
        setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'done' } : t)),
        )
    }

    return (
        <div className="grid grid-cols-[300px_1fr] gap-6 min-h-[600px]">
            {/* Left: Task list */}
            <aside className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10">
                    <h2 className="text-sm font-semibold text-zinc-300">待審核圖片</h2>
                </div>
                <ul className="divide-y divide-white/5">
                    {tasks.map((task) => (
                        <li key={task.id}>
                            <button
                                onClick={() => setActiveId(task.id)}
                                className={cn(
                                    'w-full flex items-center gap-3 px-4 py-3 text-left',
                                    'hover:bg-white/5 transition-colors',
                                    activeId === task.id && 'bg-white/10',
                                )}
                            >
                                {task.status === 'done' ? (
                                    <CheckCircle className="size-4 text-emerald-400 flex-shrink-0" aria-hidden />
                                ) : (
                                    <FileImage className="size-4 text-zinc-400 flex-shrink-0" aria-hidden />
                                )}
                                <span className="text-xs font-mono text-zinc-300 truncate">
                                    {task.placeholder}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </aside>

            {/* Right: Editor */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                {activeTask ? (
                    <DraftEditor
                        task={activeTask}
                        onBound={() => handleBound(activeTask.id)}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                        選擇左側任務開始審核
                    </div>
                )}
            </div>
        </div>
    )
}
