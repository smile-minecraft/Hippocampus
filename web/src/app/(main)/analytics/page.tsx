'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Activity,
    AlertCircle,
    BrainCircuit,
    Calendar,
    Loader2,
    Target,
    TrendingUp,
    type LucideIcon,
} from 'lucide-react'
import {
    Bar,
    BarChart,
    CartesianGrid,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'

interface StatsData {
    totalAnswered: number
    accuracy: number
    answeredToday: number
    answeredThisWeek: number
    streak: number
    dueForReviewCount: number
}

interface PerformanceData {
    subject: string
    accuracy: number
    total: number
}

interface ActivityData {
    date: string
    count: number
}

const CHART_GRID = 'rgba(144, 122, 169, 0.18)'
const CHART_TEXT = 'rgba(110, 106, 134, 0.86)'

export default function AnalyticsPage() {
    const router = useRouter()
    const [stats, setStats] = useState<StatsData | null>(null)
    const [performance, setPerformance] = useState<PerformanceData[]>([])
    const [activity, setActivity] = useState<ActivityData[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        async function fetchAllData() {
            setLoading(true)
            setError(null)

            try {
                const [statsRes, perfRes, actRes] = await Promise.all([
                    fetch('/api/analytics/stats'),
                    fetch('/api/analytics/performance'),
                    fetch('/api/analytics/activity'),
                ])

                if (!statsRes.ok || !perfRes.ok || !actRes.ok) {
                    throw new Error('無法取得分析資料')
                }

                const [statsData, perfData, actData] = await Promise.all([
                    statsRes.json(),
                    perfRes.json(),
                    actRes.json(),
                ])

                if (cancelled) return

                if (statsData.ok) setStats(statsData.data)
                if (perfData.ok) setPerformance(perfData.data)
                if (actData.ok) setActivity(actData.data)
            } catch (fetchError: unknown) {
                if (!cancelled) {
                    setError(fetchError instanceof Error ? fetchError.message : '發生未知錯誤')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        fetchAllData()
        return () => {
            cancelled = true
        }
    }, [])

    if (loading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="size-8 animate-spin text-primary-base" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="notice notice-error flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="text-sm leading-7 text-text-base">{error}</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Learning analytics"
                title="把作答紀錄整理成可閱讀的學習節奏。"
                description="新版分析頁不只是放圖表，而是用編輯式區塊呈現你的刷題強弱項、連續學習狀態與待複習密度，讓數據可以直接轉成下一步行動。"
                actions={(
                    <Button size="sm" onClick={() => router.push('/quiz')}>
                        開始今日複習
                    </Button>
                )}
                meta={(
                    <>
                        <span className="pill">FSRS-ready</span>
                        <span className="pill">14-day activity</span>
                        <span className="pill">Subject radar</span>
                    </>
                )}
            />

            <div className="page-grid-with-rail">
                <div className="space-y-6">
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {[
                            {
                                label: '總作答題數',
                                value: stats?.totalAnswered || 0,
                                icon: Activity,
                                copy: '全部累積作答',
                            },
                            {
                                label: '平均正確率',
                                value: `${stats?.accuracy || 0}%`,
                                icon: Target,
                                copy: '整體掌握度',
                            },
                            {
                                label: '連續學習天數',
                                value: `${stats?.streak || 0} 天`,
                                icon: TrendingUp,
                                copy: '目前連續節奏',
                            },
                            {
                                label: '今日待複習',
                                value: stats?.dueForReviewCount || 0,
                                icon: BrainCircuit,
                                copy: 'FSRS 建議項目',
                            },
                        ].map(({ label, value, icon: Icon, copy }: { label: string; value: string | number; icon: LucideIcon; copy: string }) => (
                            <SectionCard key={String(label)} className="space-y-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="inline-flex size-12 items-center justify-center rounded-[18px] bg-primary-muted text-primary-base">
                                        <Icon className="size-5" />
                                    </div>
                                    <span className="page-header-eyebrow">{copy}</span>
                                </div>
                                <div>
                                    <p className="text-sm text-text-muted">{label}</p>
                                    <p className="mt-2 font-heading text-3xl font-bold text-text-base">{value}</p>
                                </div>
                            </SectionCard>
                        ))}
                    </section>

                    <SectionCard title="學科掌握度分析" description="用單張雷達圖檢查目前各學科的正確率分佈。">
                        <div className="h-80 w-full">
                            {performance.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart cx="50%" cy="50%" outerRadius="72%" data={performance}>
                                        <PolarGrid stroke={CHART_GRID} />
                                        <PolarAngleAxis dataKey="subject" tick={{ fill: CHART_TEXT, fontSize: 12 }} />
                                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: CHART_TEXT, fontSize: 11 }} />
                                        <Radar
                                            name="正確率 (%)"
                                            dataKey="accuracy"
                                            stroke="var(--primary-base)"
                                            fill="var(--primary-base)"
                                            fillOpacity={0.24}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'var(--surface-base)',
                                                border: '1px solid var(--border-base)',
                                                borderRadius: '18px',
                                                color: 'var(--text-base)',
                                            }}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            ) : (
                                <EmptyChartState copy="尚無足夠的作答紀錄可供分析。" />
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="近 14 天學習活躍度" description="用最近兩週的作答量觀察學習節奏是否穩定。">
                        <div className="h-80 w-full">
                            {activity.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: CHART_TEXT, fontSize: 12 }}
                                            tickFormatter={(value) => {
                                                const date = new Date(value)
                                                return `${date.getMonth() + 1}/${date.getDate()}`
                                            }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            tick={{ fill: CHART_TEXT, fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                            allowDecimals={false}
                                        />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(144, 122, 169, 0.12)' }}
                                            contentStyle={{
                                                backgroundColor: 'var(--surface-base)',
                                                border: '1px solid var(--border-base)',
                                                borderRadius: '18px',
                                                color: 'var(--text-base)',
                                            }}
                                            labelFormatter={(value) => `日期：${value}`}
                                        />
                                        <Bar
                                            dataKey="count"
                                            name="作答題數"
                                            fill="var(--secondary-base)"
                                            radius={[8, 8, 0, 0]}
                                            maxBarSize={40}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <EmptyChartState copy="尚無近期的作答紀錄。" />
                            )}
                        </div>
                    </SectionCard>
                </div>

                <aside className="page-rail">
                    <SectionCard title="今日節奏摘要" description="快速讀懂目前學習狀態。">
                        <div className="space-y-3 text-sm leading-7 text-text-muted">
                            <p>今天已完成 <span className="font-semibold text-text-base">{stats?.answeredToday || 0}</span> 題。</p>
                            <p>本週累積 <span className="font-semibold text-text-base">{stats?.answeredThisWeek || 0}</span> 題。</p>
                            <p>待複習題數是當前最直接的下一步，優先清理可以讓節奏最穩。</p>
                        </div>
                    </SectionCard>
                    <SectionCard title="操作建議" description="讓分析結果直接轉成行動。">
                        <div className="grid gap-2">
                            <Button variant="secondary" onClick={() => router.push('/quiz?limit=10')}>
                                先刷 10 題
                            </Button>
                            <Button variant="secondary" onClick={() => router.push('/quiz/history')}>
                                檢視作答紀錄
                            </Button>
                        </div>
                    </SectionCard>
                    <SectionCard title="FSRS 觀點" description="當待複習題數持續上升時，代表近期輸入的記憶開始需要回收。">
                        <div className="inline-flex items-center gap-2 text-sm text-text-muted">
                            <Calendar className="size-4 text-primary-base" />
                            讓複習密度維持在每天都能完成的範圍。
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </div>
    )
}

function EmptyChartState({ copy }: { copy: string }) {
    return (
        <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-border-base bg-bg-surface text-sm text-text-muted">
            {copy}
        </div>
    )
}
