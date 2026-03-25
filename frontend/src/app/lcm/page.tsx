"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { getApiBaseUrl } from "@/lib/api-base";
import { useQuery } from "@tanstack/react-query";
import { Layers, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/templates/DashboardShell";
import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { ApiError } from "@/api/mutator";
import { cn } from "@/lib/utils";

// ------ Types ------
interface LCMStatsOverview {
  conversations: number;
  messages: number;
  summaries_leaf: number;
  summaries_condensed: number;
}

interface LCMSessionProgress {
  session_key: string;
  agent_name: string | null;
  message_count: number;
  token_count: number;
  leaf_count: number;
  condensed_count: number;
  processed_messages: number;
  last_updated: string | null;
  raw_tokens_outside_tail: number;
}

interface LCMConfig {
  fresh_tail_count: number;
  leaf_chunk_tokens: number;
}

interface LCMDepthBucket {
  kind: string;
  depth: number;
  count: number;
}

interface LCMStatsResponse {
  overview: LCMStatsOverview;
  sessions: LCMSessionProgress[];
  depth_distribution: LCMDepthBucket[];
  config: LCMConfig | null;
}

// ------ API ------
const fetchLcmStats = async (): Promise<LCMStatsResponse> => {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/v1/memories/lcm-stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch LCM stats: ${response.statusText}`);
  }
  return response.json();
};

// ------ Helpers ------
function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts.includes("T") || ts.includes("Z") ? ts : ts + "Z");
    return d.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

// ------ Overview Card ------
function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">
        {value.toLocaleString()}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ------ Session Table ------
function SessionTable({
  sessions,
  config,
}: {
  sessions: LCMSessionProgress[];
  config: LCMConfig | null;
}) {
  const freshTailCount = config?.fresh_tail_count ?? 32;
  const leafChunkTokens = config?.leaf_chunk_tokens ?? 20_000;

  if (sessions.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
        No sessions found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <th className="pb-2 pr-4 pt-2">名称</th>
            <th className="pb-2 px-2 pt-2">压缩进度</th>
            <th className="pb-2 px-2 pt-2">待压缩水位</th>
            <th className="pb-2 px-2 pt-2 text-right">消息数</th>
            <th className="pb-2 px-2 pt-2 text-right">Token量</th>
            <th className="pb-2 px-2 pt-2 text-right">Leaf摘要</th>
            <th className="pb-2 px-2 pt-2 text-right">Condensed摘要</th>
            <th className="pb-2 pl-2 pt-2 text-right">最后更新</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sessions.map((s) => {
            // 压缩进度
            const compressible = Math.max(
              s.message_count - freshTailCount,
              s.processed_messages,
            );
            const pct =
              compressible > 0
                ? Math.min(
                    Math.round((s.processed_messages / compressible) * 100),
                    100,
                  )
                : 0;
            const pctColor =
              pct >= 80
                ? "bg-emerald-500"
                : pct >= 50
                  ? "bg-amber-400"
                  : "bg-slate-300";
            const compressTooltip = `最近 ${freshTailCount} 条消息为 freshTail 缓冲区，不计入压缩进度。`;

            // 待压缩 token 水位（vs leafChunkTokens 阈值）
            const rawTokens = s.raw_tokens_outside_tail ?? 0;
            const tokenPct = Math.min(
              Math.round((rawTokens / leafChunkTokens) * 100),
              100,
            );
            const tokenColor =
              tokenPct >= 100
                ? "bg-rose-500"
                : tokenPct >= 70
                  ? "bg-amber-400"
                  : "bg-sky-400";
            const tokenTooltip = `待压缩 Token：${rawTokens.toLocaleString()} / ${leafChunkTokens.toLocaleString()}（触发阈值）。达到 100% 时下一个 turn 触发压缩。`;

            // freshTail 占用（当前 freshTail 内有多少条消息）
            const freshTailUsed = Math.min(s.message_count, freshTailCount);
            const freshPct = Math.round((freshTailUsed / freshTailCount) * 100);

            return (
              <tr key={s.session_key} className="hover:bg-slate-50">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-slate-900">
                    {s.agent_name ?? "—"}
                  </div>
                  <div className="text-xs text-slate-400 truncate max-w-[160px]">
                    {s.session_key.slice(-36)}
                  </div>
                </td>

                {/* 压缩进度 */}
                <td className="px-2 py-2.5 min-w-[160px]">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${pctColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-slate-600">
                      {pct}%
                    </span>
                    <span
                      className="cursor-help select-none text-xs text-slate-400 hover:text-slate-600"
                      title={compressTooltip}
                    >
                      ⓘ
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {s.processed_messages.toLocaleString()} /{" "}
                    {compressible.toLocaleString()} 可压缩
                  </div>
                </td>

                {/* 待压缩 token 水位 + freshTail 水位 */}
                <td className="px-2 py-2.5 min-w-[180px]">
                  {/* 待压缩 token 水位 */}
                  <div
                    className="flex items-center gap-1.5"
                    title={tokenTooltip}
                  >
                    <span className="w-16 text-right font-mono text-xs text-slate-500">
                      token
                    </span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${tokenColor}`}
                        style={{ width: `${tokenPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-slate-600 w-8">
                      {tokenPct}%
                    </span>
                  </div>
                  <div
                    className="mt-1 flex items-center gap-1.5"
                    title={`freshTail 缓冲区：${freshTailUsed}/${freshTailCount} 条`}
                  >
                    <span className="w-16 text-right font-mono text-xs text-slate-500">
                      tail
                    </span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all bg-indigo-400"
                        style={{ width: `${freshPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-slate-600 w-8">
                      {freshTailUsed}/{freshTailCount}
                    </span>
                  </div>
                </td>

                <td className="px-2 py-2.5 text-right font-mono text-slate-700">
                  {s.message_count.toLocaleString()}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-slate-700">
                  {formatNumber(s.token_count)}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {s.leaf_count}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                    {s.condensed_count}
                  </span>
                </td>
                <td className="pl-2 py-2.5 text-right text-xs text-slate-500">
                  {formatTimestamp(s.last_updated)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------ Depth Distribution Table ------
function DepthTable({ buckets }: { buckets: LCMDepthBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-[80px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
        No data
      </div>
    );
  }

  const kindColor: Record<string, string> = {
    leaf: "bg-emerald-100 text-emerald-700",
    condensed: "bg-violet-100 text-violet-700",
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <th className="pb-2 pr-4 pt-2">Kind</th>
          <th className="pb-2 px-2 pt-2 text-right">Depth</th>
          <th className="pb-2 pl-2 pt-2 text-right">Count</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {buckets.map((b) => (
          <tr key={`${b.kind}-${b.depth}`} className="hover:bg-slate-50">
            <td className="py-2.5 pr-4">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  kindColor[b.kind] ?? "bg-slate-100 text-slate-600",
                )}
              >
                {b.kind}
              </span>
            </td>
            <td className="px-2 py-2.5 text-right font-mono text-slate-700">
              {b.depth}
            </td>
            <td className="pl-2 py-2.5 text-right font-mono text-slate-700">
              {b.count.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------ Page ------
export default function LcmPage() {
  const statsQuery = useQuery<LCMStatsResponse, ApiError>({
    queryKey: ["memories", "lcm-stats"],
    queryFn: fetchLcmStats,
    enabled: true,
    refetchInterval: 30_000,
  });

  const { overview, sessions, depth_distribution, config } =
    statsQuery.data ?? {
      overview: {
        conversations: 0,
        messages: 0,
        summaries_leaf: 0,
        summaries_condensed: 0,
      },
      sessions: [],
      depth_distribution: [],
      config: null,
    };

  return (
    <DashboardShell>
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <div className="p-4 md:p-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers className="h-6 w-6 text-slate-400" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  LCM 压缩统计
                </h1>
                <p className="text-sm text-slate-500">
                  Lossless-Claw 压缩进度总览
                </p>
              </div>
            </div>
            {statsQuery.isFetching && (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>

          {/* Error */}
          {statsQuery.error && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
              Failed to load LCM stats: {statsQuery.error.message}
            </div>
          )}

          {/* Loading skeleton */}
          {statsQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm"
                />
              ))}
            </div>
          ) : (
            <>
              {/* Overview cards */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="会话数" value={overview.conversations} />
                <StatCard label="消息数" value={overview.messages} />
                <StatCard
                  label="Leaf 摘要"
                  value={overview.summaries_leaf}
                  sub="depth=0"
                />
                <StatCard
                  label="Condensed 摘要"
                  value={overview.summaries_condensed}
                  sub="depth≥1"
                />
              </div>

              {/* Session progress table */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-slate-400" />
                  Session 进度
                </h2>
                <SessionTable sessions={sessions} config={config} />
              </section>

              {/* Depth distribution table */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-base font-semibold text-slate-900">
                  Depth 分布
                </h2>
                <DepthTable buckets={depth_distribution} />
              </section>
            </>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}
