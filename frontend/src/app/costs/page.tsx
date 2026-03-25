"use client";

export const dynamic = "force-dynamic";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, MessageSquare, Users } from "lucide-react";

import { DashboardShell } from "@/components/templates/DashboardShell";
import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { SignedIn, SignedOut, useAuth } from "@/auth/clerk";
import { SignedOutPanel } from "@/components/auth/SignedOutPanel";
import { ApiError } from "@/api/mutator";
import {
  type costMetricsApiV1CostsMetricsGetResponse,
  useCostMetricsApiV1CostsMetricsGet,
} from "@/api/generated/costs/costs";
import type { CostMetrics } from "@/api/generated/model/costMetrics";

const DASH = "—";
const DEFAULT_RANGE = "7d";

const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCount(value: number): string {
  return Number.isFinite(value)
    ? numberFormatter.format(Math.max(0, Math.round(value)))
    : "0";
}

function formatCurrency(value: number): string {
  return Number.isFinite(value) ? currencyFormatter.format(value) : DASH;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return numberFormatter.format(value);
}

function TopMetricCard({
  title,
  value,
  secondary,
  icon,
  accent,
}: {
  title: string;
  value: string;
  secondary?: string;
  icon: React.ReactNode;
  accent: "blue" | "green" | "violet" | "emerald" | "amber";
}) {
  const iconTone =
    accent === "blue"
      ? "bg-blue-50 text-blue-600"
      : accent === "green"
        ? "bg-emerald-50 text-emerald-600"
        : accent === "violet"
          ? "bg-violet-50 text-violet-600"
          : accent === "amber"
            ? "bg-amber-50 text-amber-600"
            : "bg-green-50 text-green-600";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </p>
          <div className="mt-2 flex items-end gap-2">
            <p className="font-heading text-4xl font-bold text-slate-900">
              {value}
            </p>
            {secondary ? (
              <p className="pb-1 text-xs text-slate-500">{secondary}</p>
            ) : null}
          </div>
        </div>
        <div className={`rounded-lg p-2 ${iconTone}`}>{icon}</div>
      </div>
    </section>
  );
}

function InfoBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    value: string;
    tone?: "default" | "success" | "warning" | "danger";
  }>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">{title}</h3>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <span className="min-w-0 text-sm text-slate-500">{row.label}</span>
            <span
              className={`max-w-[65%] break-words text-right text-sm font-medium leading-5 ${
                row.tone === "success"
                  ? "text-emerald-700"
                  : row.tone === "warning"
                    ? "text-amber-700"
                    : row.tone === "danger"
                      ? "text-rose-700"
                      : "text-slate-800"
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function CostPage() {
  const { isSignedIn } = useAuth();

  const costsQuery = useCostMetricsApiV1CostsMetricsGet<
    costMetricsApiV1CostsMetricsGetResponse,
    ApiError
  >(
    {
      range_key: DEFAULT_RANGE,
    },
    {
      query: {
        enabled: Boolean(isSignedIn),
        refetchInterval: 60_000, // 每分钟刷新一次
        refetchOnMount: "always",
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      },
    },
  );

  const costs = costsQuery.data?.status === 200 ? costsQuery.data.data : null;

  const kpis = useMemo(() => {
    if (!costs) return null;
    return costs.kpis;
  }, [costs]);

  const dailySeries = useMemo(() => {
    if (!costs) return [];
    return costs.daily_series ?? [];
  }, [costs]);

  const modelBreakdown = useMemo(() => {
    if (!costs) return [];
    return costs.model_breakdown ?? [];
  }, [costs]);

  const agentBreakdown = useMemo((): import("@/api/generated/model/agentCostBreakdown").AgentCostBreakdown[] => {
    if (!costs) return [];
    return costs.agent_breakdown ?? [];
  }, [costs]);

  const agentDailySeries = useMemo((): import("@/api/generated/model/agentDailyPoint").AgentDailyPoint[] => {
    if (!costs) return [];
    return costs.agent_daily_series ?? [];
  }, [costs]);

  // top 5 agents by total_tokens, grouped by agent_id
  const top5AgentIds = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const row of agentDailySeries) {
      agg[row.agent_id] = (agg[row.agent_id] ?? 0) + row.total_tokens;
    }
    return Object.entries(agg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
  }, [agentDailySeries]);

  // distinct dates for the agent daily pivot table
  const agentDailyDates = useMemo(() => {
    const dates = [...new Set(agentDailySeries.map((r) => r.date))]
      .sort()
      .slice(-7);
    return dates;
  }, [agentDailySeries]);

  // agent name map
  const agentNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of agentDailySeries) {
      if (!m[row.agent_id]) {
        m[row.agent_id] = row.agent_name || row.agent_id.slice(0, 8);
      }
    }
    return m;
  }, [agentDailySeries]);

  // pivot: date -> agent_id -> total_cost_usd
  const agentDailyPivot = useMemo(() => {
    const pivot: Record<string, Record<string, number>> = {};
    for (const row of agentDailySeries) {
      if (!top5AgentIds.includes(row.agent_id)) continue;
      if (!pivot[row.date]) pivot[row.date] = {};
      pivot[row.date][row.agent_id] =
        (pivot[row.date][row.agent_id] ?? 0) + row.total_cost_usd;
    }
    return pivot;
  }, [agentDailySeries, top5AgentIds]);

  const totalCostRows = useMemo(() => {
    if (!kpis) return [];
    return [
      {
        label: "Total Cost (USD)",
        value: formatCurrency(kpis.total_cost_usd),
        tone: "default" as const,
      },
      {
        label: "Average Daily Cost",
        value: formatCurrency(kpis.avg_daily_cost_usd),
        tone: "default" as const,
      },
      {
        label: "Total Tokens",
        value: formatCompactNumber(kpis.total_tokens),
        tone: "default" as const,
      },
      {
        label: "Average Daily Tokens",
        value: formatCompactNumber(kpis.avg_daily_tokens),
        tone: "default" as const,
      },
    ];
  }, [kpis]);

  const tokenBreakdownRows = useMemo(() => {
    if (!kpis) return [];
    return [
      {
        label: "Input Tokens",
        value: formatCompactNumber(kpis.input_tokens),
        tone: "default" as const,
      },
      {
        label: "Output Tokens",
        value: formatCompactNumber(kpis.output_tokens),
        tone: "default" as const,
      },
    ];
  }, [kpis]);

  const activityRows = useMemo(() => {
    if (!kpis) return [];
    return [
      {
        label: "Conversations",
        value: formatCount(kpis.conversations_count),
        tone: "default" as const,
      },
      {
        label: "Messages",
        value: formatCount(kpis.messages_count),
        tone: "default" as const,
      },
      {
        label: "Top Model by Cost",
        value: kpis.top_model_by_cost ?? DASH,
        tone: "default" as const,
      },
    ];
  }, [kpis]);

  const recentDailyRows = useMemo(() => {
    if (!dailySeries.length) return [];
    return dailySeries.slice(-7).map((day) => ({
      label: day.date,
      value: formatCurrency(day.total_cost_usd),
      tone: "default" as const,
    }));
  }, [dailySeries]);

  return (
    <DashboardShell>
      <SignedOut>
        <SignedOutPanel
          message="Sign in to access cost tracking."
          forceRedirectUrl="/onboarding"
          signUpForceRedirectUrl="/onboarding"
        />
      </SignedOut>
      <SignedIn>
        <DashboardSidebar />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <div className="p-4 md:p-8">
            {costsQuery.error ? (
              <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
                Load failed: {costsQuery.error.message}
              </div>
            ) : null}

            <div className="mb-4">
              <h1 className="text-2xl font-bold text-slate-900">
                Cost Tracking
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Track token usage and costs across your AI conversations
              </p>
            </div>

            {!costs && costsQuery.isLoading ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Loading cost data...
              </div>
            ) : !costs ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-8 text-center text-sm text-amber-800">
                Cost data is currently unavailable. Please make sure the LCM
                database is configured.
              </div>
            ) : (
              <>
                {/* Top KPI Cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <TopMetricCard
                    title="Total Cost"
                    value={formatCurrency(kpis?.total_cost_usd ?? 0)}
                    secondary={`Avg ${formatCurrency(kpis?.avg_daily_cost_usd ?? 0)}/day`}
                    icon={<DollarSign className="h-4 w-4" />}
                    accent="emerald"
                  />
                  <TopMetricCard
                    title="Total Tokens"
                    value={formatCompactNumber(kpis?.total_tokens ?? 0)}
                    secondary={`Avg ${formatCompactNumber(kpis?.avg_daily_tokens ?? 0)}/day`}
                    icon={<TrendingUp className="h-4 w-4" />}
                    accent="blue"
                  />
                  <TopMetricCard
                    title="Conversations"
                    value={formatCount(kpis?.conversations_count ?? 0)}
                    secondary={`${formatCount(kpis?.messages_count ?? 0)} messages`}
                    icon={<Users className="h-4 w-4" />}
                    accent="violet"
                  />
                  <TopMetricCard
                    title="Messages"
                    value={formatCount(kpis?.messages_count ?? 0)}
                    secondary={`${formatCount(dailySeries.length)} days`}
                    icon={<MessageSquare className="h-4 w-4" />}
                    accent="amber"
                  />
                </div>

                {/* Detailed Information Blocks */}
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <InfoBlock title="Cost Overview" rows={totalCostRows} />
                  <InfoBlock
                    title="Token Breakdown"
                    rows={tokenBreakdownRows}
                  />
                  <InfoBlock title="Activity" rows={activityRows} />
                </div>

                {/* Daily Cost Breakdown */}
                <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">
                      Recent Daily Costs
                    </h3>
                    <span className="text-xs text-slate-500">Last 7 days</span>
                  </div>
                  {recentDailyRows.length > 0 ? (
                    <div className="space-y-2">
                      {recentDailyRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <span className="text-sm text-slate-600">
                            {row.label}
                          </span>
                          <span className="text-sm font-medium text-slate-900">
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No daily cost data available for the selected period.
                    </div>
                  )}
                </section>

                {/* Agent Breakdown */}
                <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">
                      Agent 消耗排行
                    </h3>
                    <span className="text-xs text-slate-500">
                      按 Agent 聚合
                    </span>
                  </div>
                  {agentBreakdown.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <th className="pb-2 pr-4">Agent</th>
                            <th className="pb-2 pr-4 text-right">输入 Token</th>
                            <th className="pb-2 pr-4 text-right">输出 Token</th>
                            <th className="pb-2 pr-4 text-right">总 Token</th>
                            <th className="pb-2 text-right">费用</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentBreakdown.map((agent) => (
                            <tr
                              key={agent.agent_id}
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="py-2 pr-4">
                                <p className="font-medium text-slate-900">
                                  {agent.agent_name ||
                                    agent.agent_id.slice(0, 8)}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {agent.messages_count} 条消息
                                </p>
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                                {formatCompactNumber(agent.input_tokens)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                                {formatCompactNumber(agent.output_tokens)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-slate-900 font-medium">
                                {formatCompactNumber(agent.total_tokens)}
                              </td>
                              <td className="py-2 text-right tabular-nums text-emerald-700 font-semibold">
                                {formatCurrency(agent.total_cost_usd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      暂无 Agent 消耗数据。
                    </div>
                  )}
                </section>

                {/* Agent Daily Pivot Table */}
                {top5AgentIds.length > 0 && agentDailyDates.length > 0 && (
                  <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-slate-900">
                        每日趋势（按 Agent）
                      </h3>
                      <span className="text-xs text-slate-500">
                        Top 5 Agent · 最近 7 天
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <th className="pb-2 pr-4">日期</th>
                            {top5AgentIds.map((id) => (
                              <th key={id} className="pb-2 pr-3 text-right">
                                {agentNameMap[id] || id.slice(0, 8)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {agentDailyDates.map((date) => (
                            <tr
                              key={date}
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="py-2 pr-4 text-slate-600">
                                {date}
                              </td>
                              {top5AgentIds.map((agId) => {
                                const val = agentDailyPivot[date]?.[agId];
                                return (
                                  <td
                                    key={agId}
                                    className="py-2 pr-3 text-right tabular-nums text-slate-700"
                                  >
                                    {val != null ? formatCurrency(val) : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </SignedIn>
    </DashboardShell>
  );
}
