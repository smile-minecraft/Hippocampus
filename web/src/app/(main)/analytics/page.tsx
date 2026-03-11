"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, TrendingUp, Target, BrainCircuit, Activity, Calendar } from "lucide-react";
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    Tooltip,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
} from "recharts";

interface StatsData {
    totalAnswered: number;
    accuracy: number;
    answeredToday: number;
    answeredThisWeek: number;
    streak: number;
    dueForReviewCount: number;
}

interface PerformanceData {
    subject: string;
    accuracy: number;
    total: number;
}

interface ActivityData {
    date: string;
    count: number;
}

export default function AnalyticsPage() {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [performance, setPerformance] = useState<PerformanceData[]>([]);
    const [activity, setActivity] = useState<ActivityData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAllData = async () => {
            setLoading(true);
            setError(null);
            try {
                const [statsRes, perfRes, actRes] = await Promise.all([
                    fetch('/api/analytics/stats'),
                    fetch('/api/analytics/performance'),
                    fetch('/api/analytics/activity')
                ]);

                if (!statsRes.ok || !perfRes.ok || !actRes.ok) {
                    throw new Error("無法取得分析資料");
                }

                const [statsData, perfData, actData] = await Promise.all([
                    statsRes.json(),
                    perfRes.json(),
                    actRes.json()
                ]);

                if (statsData.ok) setStats(statsData.data);
                if (perfData.ok) setPerformance(perfData.data);
                if (actData.ok) setActivity(actData.data);

            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "發生未知錯誤");
            } finally {
                setLoading(false);
            }
        };

        fetchAllData();
    }, []);

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start max-w-4xl mx-auto mt-6">
                <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-6 space-y-8 animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-text-base mb-2">學習數據儀表板</h1>
                <p className="text-text-muted">追蹤您的學習進度、強弱項分析與活躍度。</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm flex items-center">
                    <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mr-4">
                        <Activity className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <p className="text-sm text-text-muted font-medium">總作答題數</p>
                        <p className="text-2xl font-bold text-text-base">{stats?.totalAnswered || 0}</p>
                    </div>
                </div>

                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm flex items-center">
                    <div className="w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center mr-4">
                        <Target className="w-6 h-6 text-teal-400" />
                    </div>
                    <div>
                        <p className="text-sm text-text-muted font-medium">平均正確率</p>
                        <p className="text-2xl font-bold text-text-base">{stats?.accuracy || 0}%</p>
                    </div>
                </div>

                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm flex items-center">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mr-4">
                        <TrendingUp className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-sm text-text-muted font-medium">連續學習天數</p>
                        <p className="text-2xl font-bold text-text-base">{stats?.streak || 0} 天</p>
                    </div>
                </div>

                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm flex items-center relative overflow-hidden group cursor-pointer hover:border-teal-500/50 transition-colors">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-teal-500/20 to-transparent -mr-8 -mt-8 rounded-full transition-transform group-hover:scale-150"></div>
                    <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mr-4 relative z-10">
                        <BrainCircuit className="w-6 h-6 text-purple-400" />
                    </div>
                    <div className="relative z-10">
                        <p className="text-sm text-text-muted font-medium">今日待複習 (FSRS)</p>
                        <p className="text-2xl font-bold text-text-base">{stats?.dueForReviewCount || 0}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Radar Chart: Subject Performance */}
                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-text-base mb-6 flex items-center">
                        <Target className="w-5 h-5 mr-2 text-teal-400" />
                        學科掌握度分析
                    </h2>
                    <div className="h-80 w-full">
                        {performance && performance.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={performance}>
                                    <PolarGrid stroke="#374151" />
                                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#4B5563' }} />
                                    <Radar
                                        name="正確率 (%)"
                                        dataKey="accuracy"
                                        stroke="#14B8A6"
                                        fill="#14B8A6"
                                        fillOpacity={0.3}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
                                        itemStyle={{ color: '#14B8A6' }}
                                    />
                                </RadarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-text-muted">
                                尚無足夠的作答紀錄可供分析
                            </div>
                        )}
                    </div>
                </div>

                {/* Bar Chart: Recent Activity */}
                <div className="bg-bg-surface rounded-2xl border border-border-base p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-text-base mb-6 flex items-center">
                        <Calendar className="w-5 h-5 mr-2 text-teal-400" />
                        近 14 天學習活躍度
                    </h2>
                    <div className="h-80 w-full">
                        {activity && activity.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={activity} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" />
                                    <XAxis 
                                        dataKey="date" 
                                        tick={{ fill: '#9CA3AF', fontSize: 12 }} 
                                        tickFormatter={(val) => {
                                            const d = new Date(val);
                                            return `${d.getMonth() + 1}/${d.getDate()}`;
                                        }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis 
                                        tick={{ fill: '#9CA3AF', fontSize: 12 }} 
                                        axisLine={false}
                                        tickLine={false}
                                        allowDecimals={false}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#374151', opacity: 0.4 }}
                                        contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
                                        labelFormatter={(val) => `日期: ${val}`}
                                    />
                                    <Bar 
                                        dataKey="count" 
                                        name="作答題數" 
                                        fill="#14B8A6" 
                                        radius={[4, 4, 0, 0]} 
                                        maxBarSize={40}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-text-muted">
                                尚無近期的作答紀錄
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* FSRS Info Box */}
            <div className="bg-gradient-to-r from-teal-900/40 to-cyan-900/40 border border-teal-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-teal-400 mb-2">基於 FSRS 演算法的智慧複習</h3>
                    <p className="text-sm text-text-muted max-w-2xl">
                        系統會根據您的作答歷程與正確率，動態計算每道題目的記憶遺忘曲線，並在最適合的時機安排複習，幫助您將短期記憶轉化為長期記憶。
                    </p>
                </div>
                <button
                    className="mt-4 md:mt-0 bg-teal-500 hover:bg-teal-400 text-white font-medium px-6 py-2.5 rounded-lg transition-colors whitespace-nowrap"
                    onClick={() => window.location.href = '/quiz'}
                >
                    開始今日複習
                </button>
            </div>
        </div>
    );
}