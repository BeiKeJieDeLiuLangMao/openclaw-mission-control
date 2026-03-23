"use client";

export const dynamic = "force-dynamic";

import React, { useState } from "react";
import { getApiBaseUrl } from "@/lib/api-base";
import { useQuery } from "@tanstack/react-query";
import {
  Layers,
  RefreshCw,
  ChevronDown,
  Loader2,
} from "lucide-react";

import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { DashboardShell } from "@/components/templates/DashboardShell";
import { ApiError } from "@/api/mutator";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface LCMAgentItem {
  session_key: string;
  agent_name: string;
}

interface LCMSummaryItem {
  summary_id: string;
  session_key: string;
  agent_name: string | null;
  kind: string;
  depth: number;
  token_count: number;
  descendant_count: number;
  earliest_at: string | null;
  latest_at: string | null;
  content_preview: string;
}

interface LCMSummaryDetail extends LCMSummaryItem {
  content: string;
  parent_ids: string[];
  child_ids: string[];
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

const fetchLcmStats = async (): Promise<LCMStatsResponse> => {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/memories/lcm-stats`);
  if (!res.ok) throw new Error(`lcm-stats failed: ${res.statusText}`);
  return res.json();
};

const fetchLCMAgents = async (): Promise<LCMAgentItem[]> => {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/memories/lcm-agents`);
  if (!res.ok) throw new Error(`lcm-agents failed: ${res.statusText}`);
  return res.json();
};

const fetchLCMSummaries = async (
  agentFilter: string,
  kindFilter: string,
  offset: number,
  limit = 20,
): Promise<{ items: LCMSummaryItem[]; total: number; limit: number; offset: number }> => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (agentFilter) params.set("session_key", agentFilter);
  if (kindFilter && kindFilter !== "all") params.set("kind", kindFilter);
  const res = await fetch(`${getApiBaseUrl()}/api/v1/memories/lcm-summaries?${params}`);
  if (!res.ok) throw new Error(`lcm-summaries failed: ${res.statusText}`);
  return res.json();
};

const fetchLCMSummaryDetail = async (id: string): Promise<LCMSummaryDetail> => {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/memories/lcm-summary/${id}`);
  if (!res.ok) throw new Error(`lcm-summary detail failed: ${res.statusText}`);
  return res.json();
};

// ─── Utilities ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  const s = ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z";
  return new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  const s = ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z";
  return new Date(s).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── Small Components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const styles: Record<string, string> = {
    leaf: "bg-emerald-100 text-emerald-700",
    condensed: "bg-violet-100 text-violet-700",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", styles[kind] ?? "bg-slate-100 text-slate-600")}>
      {kind}
    </span>
  );
}

function DepthBadge({ depth }: { depth: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
      d{depth}
    </span>
  );
}

// ─── Session Progress Table ────────────────────────────────────────────────────

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
            <th className="pb-2 px-2 pt-2 text-right">Leaf</th>
            <th className="pb-2 px-2 pt-2 text-right">Condensed</th>
            <th className="pb-2 pl-2 pt-2 text-right">最后更新</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sessions.map((s) => {
            const compressible = Math.max(s.message_count - freshTailCount, s.processed_messages);
            const pct = compressible > 0 ? Math.min(Math.round((s.processed_messages / compressible) * 100), 100) : 0;
            const pctColor = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-slate-300";

            const rawTokens = s.raw_tokens_outside_tail ?? 0;
            const tokenPct = Math.min(Math.round((rawTokens / leafChunkTokens) * 100), 100);
            const tokenColor = tokenPct >= 100 ? "bg-rose-500" : tokenPct >= 70 ? "bg-amber-400" : "bg-sky-400";

            const freshUsed = Math.min(s.message_count, freshTailCount);
            const freshPct = Math.round((freshUsed / freshTailCount) * 100);

            return (
              <tr key={s.session_key} className="hover:bg-slate-50">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-slate-900">{s.agent_name ?? "—"}</div>
                  <div className="max-w-[160px] truncate text-xs text-slate-400">{s.session_key.slice(-36)}</div>
                </td>
                <td className="px-2 py-2.5 min-w-[150px]">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${pctColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-xs text-slate-600">{pct}%</span>
                    <span
                      className="cursor-help select-none text-xs text-slate-400 hover:text-slate-600"
                      title={`最近 ${freshTailCount} 条为 freshTail 缓冲区，不计入压缩进度。`}
                    >ⓘ</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {s.processed_messages.toLocaleString()} / {compressible.toLocaleString()}
                  </div>
                </td>
                <td className="px-2 py-2.5 min-w-[180px]">
                  <div className="flex items-center gap-1.5" title={`待压缩 token：${rawTokens.toLocaleString()} / ${leafChunkTokens.toLocaleString()}（触发阈值）`}>
                    <span className="w-10 text-right font-mono text-xs text-slate-500">token</span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${tokenColor}`} style={{ width: `${tokenPct}%` }} />
                    </div>
                    <span className="w-8 font-mono text-xs text-slate-600">{tokenPct}%</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5" title={`freshTail：${freshUsed}/${freshTailCount} 条`}>
                    <span className="w-10 text-right font-mono text-xs text-slate-500">tail</span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-all bg-indigo-400" style={{ width: `${freshPct}%` }} />
                    </div>
                    <span className="w-8 font-mono text-xs text-slate-600">{freshUsed}/{freshTailCount}</span>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-slate-700">{s.message_count.toLocaleString()}</td>
                <td className="px-2 py-2.5 text-right font-mono text-slate-700">{formatNumber(s.token_count)}</td>
                <td className="px-2 py-2.5 text-right">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{s.leaf_count}</span>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">{s.condensed_count}</span>
                </td>
                <td className="pl-2 py-2.5 text-right text-xs text-slate-500">{formatTimestamp(s.last_updated)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Depth Distribution Table ──────────────────────────────────────────────────

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
            <td className="py-2 pr-4">
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", kindColor[b.kind] ?? "bg-slate-100 text-slate-600")}>{b.kind}</span>
            </td>
            <td className="px-2 py-2 text-right font-mono text-slate-700">{b.depth}</td>
            <td className="pl-2 py-2 text-right font-mono text-slate-700">{b.count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── LCM Summary Card ─────────────────────────────────────────────────────────

function LCMSummaryCard({
  summary,
  onViewDetail,
}: {
  summary: LCMSummaryItem;
  onViewDetail: (id: string) => void;
}) {
  return (
    <div
      className="cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:bg-slate-50"
      onClick={() => onViewDetail(summary.summary_id)}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <KindBadge kind={summary.kind} />
            <DepthBadge depth={summary.depth} />
            <span className="truncate text-[11px] text-slate-500" title={summary.session_key}>
              {summary.agent_name ?? (summary.session_key.length > 30 ? `...${summary.session_key.slice(-27)}` : summary.session_key)}
            </span>
          </div>
          <p className="line-clamp-2 text-xs text-slate-600">{summary.content_preview}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-slate-500">{summary.token_count} tokens</p>
          {summary.descendant_count > 0 && (
            <p className="text-[10px] text-slate-400">{summary.descendant_count} desc</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <span>{formatTime(summary.earliest_at)} ~ {formatTime(summary.latest_at)}</span>
      </div>
    </div>
  );
}

// ─── LCM Summary Detail Modal ──────────────────────────────────────────────────

function LCMSummaryDetailModal({
  summaryId,
  onClose,
}: {
  summaryId: string;
  onClose: () => void;
}) {
  const detailQuery = useQuery<LCMSummaryDetail, ApiError>({
    queryKey: ["memories", "lcm-summary", summaryId],
    queryFn: () => fetchLCMSummaryDetail(summaryId),
    enabled: Boolean(summaryId),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">LCM Summary Detail</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-mono">ID: {summaryId}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 transition hover:text-slate-600">
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {detailQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              加载中...
            </div>
          ) : detailQuery.isError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              加载失败: {detailQuery.error.message}
            </div>
          ) : detailQuery.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-slate-700">Agent:</span>
                  <p className="mt-1 text-slate-600">{detailQuery.data.agent_name ?? "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Session:</span>
                  <p className="mt-1 break-all text-xs text-slate-500">{detailQuery.data.session_key}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Kind / Depth:</span>
                  <div className="mt-1 flex gap-2">
                    <KindBadge kind={detailQuery.data.kind} />
                    <DepthBadge depth={detailQuery.data.depth} />
                  </div>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Tokens:</span>
                  <p className="mt-1 text-slate-600">{detailQuery.data.token_count.toLocaleString()}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Time Range:</span>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatTimestamp(detailQuery.data.earliest_at)} ~ {formatTimestamp(detailQuery.data.latest_at)}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Descendants:</span>
                  <p className="mt-1 text-slate-600">{detailQuery.data.descendant_count}</p>
                </div>
              </div>

              {detailQuery.data.parent_ids.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-slate-700">Parents:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {detailQuery.data.parent_ids.map((pid) => (
                      <span key={pid} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{pid.slice(0, 8)}…</span>
                    ))}
                  </div>
                </div>
              )}

              {detailQuery.data.child_ids.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-slate-700">Children:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {detailQuery.data.child_ids.map((cid) => (
                      <span key={cid} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{cid.slice(0, 8)}…</span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-sm font-medium text-slate-700">Content:</span>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {detailQuery.data.content}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── LCM Summary List ─────────────────────────────────────────────────────────

const LCM_LIMIT = 20;

function LCMSummaryList() {
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agentsQuery = useQuery<LCMAgentItem[], ApiError>({
    queryKey: ["memories", "lcm-agents"],
    queryFn: fetchLCMAgents,
    refetchInterval: 60_000,
  });

  const summariesQuery = useQuery({
    queryKey: ["memories", "lcm-summaries", agentFilter, kindFilter, offset],
    queryFn: () => fetchLCMSummaries(agentFilter, kindFilter, offset, LCM_LIMIT),
    refetchInterval: 30_000,
  });

  const agents = agentsQuery.data ?? [];
  const items = summariesQuery.data?.items ?? [];
  const total = summariesQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / LCM_LIMIT);
  const currentPage = Math.floor(offset / LCM_LIMIT) + 1;

  const handleAgentChange = (v: string) => { setAgentFilter(v); setOffset(0); };
  const handleKindChange = (v: string) => { setKindFilter(v); setOffset(0); };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">摘要记录</h2>
        <div className="flex items-center gap-2">
          {/* Agent filter */}
          <select
            value={agentFilter}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="">所有成员</option>
            {agents.map((a) => (
              <option key={a.session_key} value={a.session_key}>{a.agent_name}</option>
            ))}
          </select>

          {/* Kind filter */}
          <select
            value={kindFilter}
            onChange={(e) => handleKindChange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="all">所有类型</option>
            <option value="leaf">leaf</option>
            <option value="condensed">condensed</option>
          </select>

          {summariesQuery.isFetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />
          )}
        </div>
      </div>

      {summariesQuery.isLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载中...
        </div>
      ) : summariesQuery.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          加载失败: {(summariesQuery.error as Error).message}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">暂无摘要记录</div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <LCMSummaryCard key={s.summary_id} summary={s} onViewDetail={setSelectedId} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > LCM_LIMIT && (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>共 {total} 条 · 第 {currentPage} / {totalPages} 页</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LCM_LIMIT))}
              disabled={offset === 0}
              className="rounded border border-slate-200 px-2.5 py-1 transition hover:bg-slate-50 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setOffset(offset + LCM_LIMIT)}
              disabled={offset + LCM_LIMIT >= total}
              className="rounded border border-slate-200 px-2.5 py-1 transition hover:bg-slate-50 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <LCMSummaryDetailModal summaryId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </section>
  );
}

// ─── MemOS Types ──────────────────────────────────────────────────────────────

interface MemosTierDistribution {
  L1: number;
  L2: number;
  L3: number;
  unclassified: number;
}

interface MemosHeatDistribution {
  hot: number;
  warm: number;
  cold: number;
  archived: number;
}

interface MemosSupersession {
  total_superseded: number;
  recent_top5: Array<{ id: string; superseded_by: string; superseded_at: number | null }>;
}

interface MemosGraphStats {
  node_count: number;
  edge_count: number;
  entity_count: number;
}

interface MemosConflicts {
  total: number;
  unresolved: number;
  recent_3: Array<{ id: string | number; chunk_id_a: string; chunk_id_b: string; conflict_reason: string; detected_at: number | null }>;
}

interface MemosGuardian {
  last_scan_at: string | number | null;
  low_quality_count: number;
}

interface MemosObSession {
  conversation_id: string | number;
  session_key: string;
  title: string;
  msg_count: number;
  last_active_at: string | null;
}

interface MemosDashboard {
  tier_distribution: MemosTierDistribution;
  importance_histogram: Array<{ range: string; count: number }>;
  supersession: MemosSupersession;
  graph_stats: MemosGraphStats;
  conflicts: MemosConflicts;
  heat_distribution: MemosHeatDistribution;
  guardian: MemosGuardian;
  ob_sessions: MemosObSession[];
}

// ─── MemOS Fetch ───────────────────────────────────────────────────────────────

const fetchMemosDashboard = async (): Promise<MemosDashboard> => {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/memories/memos-dashboard`);
  if (!res.ok) throw new Error(`memos-dashboard failed: ${res.statusText}`);
  return res.json();
};

// ─── MemOS Components ─────────────────────────────────────────────────────────

function MemosStatCard({
  label,
  value,
  emoji,
  sub,
  dimIfZero = true,
}: {
  label: string;
  value: number;
  emoji?: string;
  sub?: string;
  dimIfZero?: boolean;
}) {
  const isZero = value === 0;
  return (
    <div className={cn(
      "rounded-xl border p-4 shadow-sm",
      isZero && dimIfZero
        ? "border-slate-700 bg-slate-800/60"
        : "border-slate-600 bg-slate-800",
    )}>
      <p className={cn("text-xs font-medium uppercase tracking-wider", isZero && dimIfZero ? "text-slate-500" : "text-slate-400")}>
        {emoji && <span className="mr-1">{emoji}</span>}{label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", isZero && dimIfZero ? "text-slate-600" : "text-slate-100")}>
        {value.toLocaleString()}
      </p>
      {sub && <p className={cn("mt-0.5 text-xs", isZero && dimIfZero ? "text-slate-600" : "text-slate-400")}>{sub}</p>}
      {isZero && dimIfZero && (
        <p className="mt-1 text-[10px] text-slate-600">暂无数据</p>
      )}
    </div>
  );
}

function MemosSectionCard({ title, children, icon }: { title: string; children: React.ReactNode; icon?: string }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/80 p-4 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-200">
        {icon && <span>{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function MemosPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-16 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/40 text-xs text-slate-500">
      {text}
    </div>
  );
}

function MemosDashboardSection() {
  const dashQuery = useQuery<MemosDashboard, Error>({
    queryKey: ["memories", "memos-dashboard"],
    queryFn: fetchMemosDashboard,
    refetchInterval: 30_000,
  });

  const data = dashQuery.data;
  const isLoading = dashQuery.isLoading;

  const formatScanTime = (ts: string | number | null): string => {
    if (!ts) return "从未扫描";
    if (typeof ts === "number") {
      return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    }
    return new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  };

  return (
    <div className="space-y-6">
      {/* MemOS section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-200">MemOS 记忆系统</h2>
          <p className="text-xs text-slate-500">Tier分级 · 热度 · 图谱 · 冲突检测 · Guardian</p>
        </div>
        {dashQuery.isFetching && (
          <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />
        )}
      </div>

      {dashQuery.isError && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-400">
          MemOS 数据加载失败: {dashQuery.error.message}
        </div>
      )}

      {/* Tier distribution */}
      <MemosSectionCard title="Tier 分布" icon="🎯">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-700 bg-slate-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MemosStatCard label="L1 精华" emoji="⭐" value={data?.tier_distribution.L1 ?? 0} sub="7天内" />
            <MemosStatCard label="L2 工作" emoji="📋" value={data?.tier_distribution.L2 ?? 0} sub="7-30天" />
            <MemosStatCard label="L3 归档" emoji="📚" value={data?.tier_distribution.L3 ?? 0} sub="30天以上" />
            <MemosStatCard label="未分级" emoji="❓" value={data?.tier_distribution.unclassified ?? 0} sub="F1未运行" dimIfZero={false} />
          </div>
        )}
      </MemosSectionCard>

      {/* Heat distribution */}
      <MemosSectionCard title="热度分布" icon="📊">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-700 bg-slate-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MemosStatCard label="Hot" emoji="🔥" value={data?.heat_distribution.hot ?? 0} sub="7天内访问" />
            <MemosStatCard label="Warm" emoji="♨️" value={data?.heat_distribution.warm ?? 0} sub="7-30天" />
            <MemosStatCard label="Cold" emoji="❄️" value={data?.heat_distribution.cold ?? 0} sub="未访问/30天+" />
            <MemosStatCard label="Archived" emoji="📦" value={data?.heat_distribution.archived ?? 0} sub="已归档" />
          </div>
        )}
      </MemosSectionCard>

      {/* Bottom row: Supersession | Graph | Conflicts | Guardian */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Supersession */}
        <MemosSectionCard title="Supersession" icon="🔄">
          {isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-800" />
          ) : (
            <div>
              <div className="text-3xl font-bold text-slate-100">
                {data?.supersession.total_superseded ?? 0}
              </div>
              <p className="mt-1 text-xs text-slate-400">被替代的记忆</p>
              {(data?.supersession.total_superseded ?? 0) === 0 ? (
                <MemosPlaceholder text="功能待激活" />
              ) : (
                <div className="mt-2 space-y-1">
                  {data?.supersession.recent_top5.slice(0, 3).map((s) => (
                    <div key={s.id} className="truncate text-xs text-slate-500">
                      → {s.superseded_by.slice(0, 20)}…
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </MemosSectionCard>

        {/* Graph stats */}
        <MemosSectionCard title="图谱状态" icon="🕸️">
          {isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-800" />
          ) : (
            <div>
              {(data?.graph_stats.node_count ?? 0) === 0 && (data?.graph_stats.edge_count ?? 0) === 0 ? (
                <>
                  <MemosPlaceholder text="功能待激活" />
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "节点", val: 0 },
                      { label: "边", val: 0 },
                      { label: "实体", val: 0 },
                    ].map((x) => (
                      <div key={x.label} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                        <p className="text-lg font-bold text-slate-600">{x.val}</p>
                        <p className="text-[10px] text-slate-600">{x.label}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "节点", val: data?.graph_stats.node_count ?? 0 },
                    { label: "边", val: data?.graph_stats.edge_count ?? 0 },
                    { label: "实体", val: data?.graph_stats.entity_count ?? 0 },
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border border-slate-600 bg-slate-900/60 p-2">
                      <p className="text-xl font-bold text-slate-100">{x.val.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">{x.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </MemosSectionCard>

        {/* Conflicts */}
        <MemosSectionCard title="冲突检测" icon="⚡">
          {isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-800" />
          ) : (
            <div>
              {(data?.conflicts.total ?? 0) === 0 ? (
                <>
                  <div className="text-3xl font-bold text-slate-600">0</div>
                  <p className="mt-1 text-xs text-slate-500">无冲突记录</p>
                  <MemosPlaceholder text="功能待激活" />
                </>
              ) : (
                <>
                  <div className="flex items-end gap-3">
                    <div>
                      <div className="text-3xl font-bold text-slate-100">{data?.conflicts.total}</div>
                      <p className="text-xs text-slate-400">总冲突</p>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-rose-400">{data?.conflicts.unresolved}</div>
                      <p className="text-xs text-slate-400">未解决</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </MemosSectionCard>

        {/* Guardian */}
        <MemosSectionCard title="Guardian" icon="🛡️">
          {isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-800" />
          ) : (
            <div>
              {!data?.guardian.last_scan_at ? (
                <>
                  <MemosPlaceholder text="从未扫描" />
                  <p className="mt-2 text-xs text-slate-500">低质量: <span className="text-slate-400">{data?.guardian.low_quality_count ?? 0}</span> 条</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-400">最近扫描</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-200">{formatScanTime(data?.guardian.last_scan_at ?? null)}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-400">低质量:</span>
                    <span className={cn("text-sm font-bold", (data?.guardian.low_quality_count ?? 0) > 0 ? "text-amber-400" : "text-slate-400")}>
                      {data?.guardian.low_quality_count ?? 0}
                    </span>
                    <span className="text-xs text-slate-500">条</span>
                  </div>
                </>
              )}
            </div>
          )}
        </MemosSectionCard>
      </div>

      {/* Observer Sessions */}
      <MemosSectionCard title="Observer 会话" icon="👁️">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-slate-800" />
        ) : (data?.ob_sessions ?? []).length === 0 ? (
          <MemosPlaceholder text="暂无 Observer 会话记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-4 pt-2">Session Key</th>
                  <th className="pb-2 px-2 pt-2 text-right">消息数</th>
                  <th className="pb-2 pl-2 pt-2 text-right">最后活跃</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {data?.ob_sessions.map((s) => (
                  <tr key={s.conversation_id} className="hover:bg-slate-700/30">
                    <td className="py-2 pr-4 text-xs text-slate-300">{s.session_key}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-300">{s.msg_count}</td>
                    <td className="pl-2 py-2 text-right text-xs text-slate-500">{formatTimestamp(s.last_active_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MemosSectionCard>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const statsQuery = useQuery<LCMStatsResponse, ApiError>({
    queryKey: ["memories", "lcm-stats"],
    queryFn: fetchLcmStats,
    refetchInterval: 30_000,
  });

  const { overview, sessions, depth_distribution, config } = statsQuery.data ?? {
    overview: { conversations: 0, messages: 0, summaries_leaf: 0, summaries_condensed: 0 },
    sessions: [],
    depth_distribution: [],
    config: null,
  };

  return (
    <DashboardShell>
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <div className="space-y-6 p-4 md:p-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers className="h-6 w-6 text-slate-400" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">记忆管理</h1>
                <p className="text-sm text-slate-500">Lossless-Claw 压缩进度 · 摘要记录</p>
              </div>
            </div>
            {statsQuery.isFetching && (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>

          {statsQuery.error && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
              加载失败: {statsQuery.error.message}
            </div>
          )}

          {/* Overview cards */}
          {statsQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="会话数" value={overview.conversations} />
              <StatCard label="消息数" value={overview.messages} />
              <StatCard label="Leaf 摘要" value={overview.summaries_leaf} sub="depth=0" />
              <StatCard label="Condensed 摘要" value={overview.summaries_condensed} sub="depth≥1" />
            </div>
          )}

          {/* Session progress */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Layers className="h-4 w-4 text-slate-400" />
              Session 压缩进度
            </h2>
            {statsQuery.isLoading ? (
              <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <SessionTable sessions={sessions} config={config} />
            )}
          </section>

          {/* Depth distribution */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Depth 分布</h2>
            {statsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <DepthTable buckets={depth_distribution} />
            )}
          </section>

          {/* LCM summary list */}
          <LCMSummaryList />

          {/* Divider */}
          <div className="border-t border-slate-700/50 pt-2" />

          {/* MemOS Dashboard */}
          <MemosDashboardSection />
        </div>
      </main>
    </DashboardShell>
  );
}
