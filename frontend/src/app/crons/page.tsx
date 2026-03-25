"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { getApiBaseUrl } from "@/lib/api-base";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Filter,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Play,
  SkipForward,
  CalendarDays,
  List,
  AlertCircle,
  X,
} from "lucide-react";

import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { DashboardShell } from "@/components/templates/DashboardShell";
import { ApiError } from "@/api/mutator";
import { cn } from "@/lib/utils";

// ------ Types ------
interface CronSchedule {
  kind: string;
  expr?: string;
  tz?: string;
  everyMs?: number;
  anchorMs?: number;
  staggerMs?: number;
}

interface CronState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: string;
  lastRunStatus?: string;
  lastDurationMs?: number;
  lastDeliveryStatus?: string;
  consecutiveErrors?: number;
  lastError?: string;
  lastErrorReason?: string;
}

interface CronJob {
  id: string;
  name?: string;
  agentId?: string;
  agent_name?: string;
  sessionKey?: string;
  enabled: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule?: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  state?: CronState;
  payload?: {
    kind?: string;
    message?: string;
    timeoutSeconds?: number;
  };
  delivery?: {
    mode?: string;
  };
}

interface CronsResponse {
  jobs: CronJob[];
  total: number;
}

interface JobRun {
  dayIndex: number;
  timeLabel: string;
  ts: number;
  status?: string; // "ok" | "error" | "skipped" | "running" | "scheduled"
}

// ------ API ------
const DEFAULT_BOARD_ID = "da4fada7-d08d-4591-9631-a501a75af897";

const fetchCronJobs = async (): Promise<CronsResponse> => {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(
    `${baseUrl}/api/v1/crons/jobs?board_id=${DEFAULT_BOARD_ID}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch cron jobs: ${response.statusText}`);
  }
  return response.json();
};

// ------ Helpers ------
function formatMs(ms?: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractAgentName(
  sessionKey?: string,
  agentId?: string,
  agentName?: string,
): string {
  if (agentName) return agentName;
  if (!sessionKey && !agentId) return "—";
  if (sessionKey) {
    const parts = sessionKey.split(":");
    if (parts.length >= 2) return parts[1];
  }
  return agentId ?? "—";
}

// 计算 Cron Job 在未来 7 天内的执行时刻
function getJobRunsIn7Days(job: CronJob): JobRun[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const results: JobRun[] = [];

  if (!job.enabled || !job.schedule) return results;

  const { kind, everyMs, anchorMs, expr, tz } = job.schedule;
  const now = Date.now();

  if (kind === "every" && everyMs && anchorMs) {
    const windowStart = todayStart.getTime();
    const windowEnd = windowStart + 7 * 24 * 60 * 60 * 1000;

    const elapsed = windowStart - anchorMs;
    const steps = Math.ceil(elapsed / everyMs);
    let ts = anchorMs + steps * everyMs;

    while (ts < windowEnd) {
      if (ts >= windowStart) {
        const dayIndex = Math.floor(
          (ts - todayStart.getTime()) / (24 * 60 * 60 * 1000),
        );
        if (dayIndex >= 0 && dayIndex < 7) {
          const d = new Date(ts);
          const timeLabel = d.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Shanghai",
          });
          // 判断这次执行的状态
          let status = "scheduled";
          if (ts < now) {
            // 已过的触发点：用 lastRunAtMs 对比推断
            const lastRun = job.state?.lastRunAtMs;
            if (lastRun && Math.abs(lastRun - ts) < everyMs / 2) {
              status = job.state?.lastStatus ?? "ok";
            } else {
              status = "skipped";
            }
          }
          results.push({ dayIndex, timeLabel, ts, status });
        }
      }
      ts += everyMs;
    }
  } else if (kind === "cron" && expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length >= 5) {
      const minute = parseInt(parts[0], 10);
      const hour = parseInt(parts[1], 10);

      if (!isNaN(minute) && !isNaN(hour)) {
        const timezone = tz || "Asia/Shanghai";

        if (job.state?.nextRunAtMs) {
          const nextRun = job.state.nextRunAtMs;
          const nextRunDate = new Date(nextRun);
          const nextRunDayStart = new Date(nextRunDate);
          nextRunDayStart.setHours(0, 0, 0, 0);
          const daysUntilNextRun = Math.floor(
            (nextRunDayStart.getTime() - todayStart.getTime()) /
              (24 * 60 * 60 * 1000),
          );

          for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const targetTs =
              nextRun + (dayOffset - daysUntilNextRun) * 24 * 60 * 60 * 1000;

            if (targetTs >= todayStart.getTime()) {
              const d = new Date(targetTs);
              const timeLabel = d.toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: timezone,
              });

              // 推断状态
              let status = "scheduled";
              if (targetTs < now) {
                const lastRun = job.state?.lastRunAtMs;
                if (lastRun && Math.abs(lastRun - targetTs) < 3600000) {
                  status = job.state?.lastStatus ?? "ok";
                } else {
                  status = "skipped";
                }
              }
              results.push({
                dayIndex: dayOffset,
                timeLabel,
                ts: targetTs,
                status,
              });
            }
          }
        } else {
          // 没有 nextRunAtMs，直接按时间推算
          for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const timeLabel = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
            const targetTs =
              todayStart.getTime() +
              dayOffset * 86400000 +
              (hour * 60 + minute) * 60000 -
              8 * 3600000;
            results.push({
              dayIndex: dayOffset,
              timeLabel,
              ts: targetTs,
              status: "scheduled",
            });
          }
        }
      }
    }
  }

  return results;
}

// 为不同 agent 生成颜色
const AGENT_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-pink-100 text-pink-700 border-pink-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
];

function getAgentColor(agentName: string): string {
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = agentName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

// 状态颜色（日历格用）
function getStatusDotClass(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "ok":
      return "bg-emerald-400";
    case "error":
      return "bg-rose-400";
    case "skipped":
      return "bg-slate-300";
    case "running":
      return "bg-blue-400 animate-pulse";
    default:
      return "bg-slate-200"; // scheduled
  }
}

function getStatusLabel(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "ok":
      return "成功";
    case "error":
      return "失败";
    case "skipped":
      return "跳过";
    case "running":
      return "运行中";
    default:
      return "计划中";
  }
}

// ------ Status Badge ------
function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const styles: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-700",
    skipped: "bg-slate-100 text-slate-500",
    error: "bg-rose-100 text-rose-700",
    running: "bg-blue-100 text-blue-700",
  };
  const icons: Record<string, React.ReactNode> = {
    ok: <CheckCircle2 className="h-3 w-3" />,
    skipped: <SkipForward className="h-3 w-3" />,
    error: <XCircle className="h-3 w-3" />,
    running: <Play className="h-3 w-3" />,
  };
  const normalized = status.toLowerCase();
  const style = styles[normalized] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        style,
      )}
    >
      {icons[normalized]}
      {status}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        enabled
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-100 text-slate-500",
      )}
    >
      {enabled ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {enabled ? "启用" : "禁用"}
    </span>
  );
}

// ------ List View: Job Row ------
function CronJobRow({ job }: { job: CronJob }) {
  const [expanded, setExpanded] = useState(false);
  const agentLabel = extractAgentName(
    job.sessionKey,
    job.agentId,
    job.agent_name,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div
        className="cursor-pointer px-4 py-3 transition hover:bg-slate-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">
                {job.name ?? job.id}
              </p>
              <EnabledBadge enabled={job.enabled} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {agentLabel}
              </span>
              {job.schedule?.expr && (
                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-700">
                  <Clock className="h-3 w-3" />
                  {job.schedule.expr}
                  {job.schedule.tz ? ` (${job.schedule.tz})` : ""}
                </span>
              )}
              {job.schedule?.everyMs && (
                <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-2 py-0.5 font-mono text-[10px] text-violet-700">
                  <Clock className="h-3 w-3" />每{" "}
                  {job.schedule.everyMs / 60000 >= 60
                    ? `${job.schedule.everyMs / 3600000}h`
                    : `${job.schedule.everyMs / 60000}m`}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex min-w-[120px] flex-col items-end gap-1 text-[11px] text-slate-500">
              {job.state?.lastStatus && (
                <StatusBadge status={job.state.lastStatus} />
              )}
              {job.state?.nextRunAtMs && (
                <p>下次: {formatMs(job.state.nextRunAtMs)}</p>
              )}
              {job.state?.lastRunAtMs && (
                <p>上次: {formatMs(job.state.lastRunAtMs)}</p>
              )}
              {job.state?.lastDurationMs !== undefined && (
                <p>{formatDuration(job.state.lastDurationMs)}</p>
              )}
            </div>
            <div className="shrink-0">
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </div>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
          {job.state?.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{job.state.lastError}</span>
            </div>
          )}
          {job.payload?.message && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Payload
              </p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">
                {job.payload.message.slice(0, 300)}
                {job.payload.message.length > 300 ? "…" : ""}
              </pre>
            </div>
          )}
          <div className="flex gap-4 text-[10px] text-slate-500">
            {job.state?.consecutiveErrors != null &&
              job.state.consecutiveErrors > 0 && (
                <span className="text-rose-600">
                  连续失败: {job.state.consecutiveErrors}
                </span>
              )}
            {job.payload?.timeoutSeconds != null && (
              <span>超时: {job.payload.timeoutSeconds}s</span>
            )}
            {job.sessionTarget && <span>目标: {job.sessionTarget}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------ Calendar Cell Detail Modal ------
interface CalendarRunItem {
  job: CronJob;
  timeLabel: string;
  ts: number;
  status: string;
}

function CalendarDetailModal({
  item,
  onClose,
}: {
  item: CalendarRunItem;
  onClose: () => void;
}) {
  const { job, timeLabel, status } = item;
  const agentName = extractAgentName(
    job.sessionKey,
    job.agentId,
    job.agent_name,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">
            {job.name ?? job.id}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">{agentName}</p>
        </div>

        <div className="space-y-3">
          {/* 执行状态 */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">执行时间</span>
            <span className="text-xs font-medium text-slate-900">
              {timeLabel}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">执行状态</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                status === "ok"
                  ? "bg-emerald-100 text-emerald-700"
                  : status === "error"
                    ? "bg-rose-100 text-rose-700"
                    : status === "skipped"
                      ? "bg-slate-100 text-slate-500"
                      : "bg-blue-100 text-blue-700",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  getStatusDotClass(status),
                )}
              />
              {getStatusLabel(status)}
            </span>
          </div>

          {/* 上次执行 */}
          {job.state?.lastRunAtMs && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">上次执行</span>
              <span className="text-xs font-medium text-slate-900">
                {formatMs(job.state.lastRunAtMs)}
              </span>
            </div>
          )}

          {/* 耗时 */}
          {job.state?.lastDurationMs != null && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">耗时</span>
              <span className="text-xs font-medium text-slate-900">
                {formatDuration(job.state.lastDurationMs)}
              </span>
            </div>
          )}

          {/* 下次执行 */}
          {job.state?.nextRunAtMs && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">下次执行</span>
              <span className="text-xs font-medium text-slate-900">
                {formatMs(job.state.nextRunAtMs)}
              </span>
            </div>
          )}

          {/* 错误信息 */}
          {job.state?.lastError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase text-rose-400">
                错误信息
              </p>
              <p className="text-xs text-rose-700">{job.state.lastError}</p>
            </div>
          )}

          {/* 调度 */}
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
              调度规则
            </p>
            {job.schedule?.expr && (
              <p className="font-mono text-xs text-slate-700">
                {job.schedule.expr}
                {job.schedule.tz ? ` (${job.schedule.tz})` : ""}
              </p>
            )}
            {job.schedule?.everyMs && (
              <p className="font-mono text-xs text-slate-700">
                每{" "}
                {job.schedule.everyMs >= 3600000
                  ? `${job.schedule.everyMs / 3600000}h`
                  : `${job.schedule.everyMs / 60000}m`}{" "}
                执行一次
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------ Calendar View ------
function WeekCalendarView({ jobs }: { jobs: CronJob[] }) {
  const [selectedItem, setSelectedItem] = useState<CalendarRunItem | null>(
    null,
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      dayIndex: i,
      label: d.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
        timeZone: "Asia/Shanghai",
      }),
      isToday: i === 0,
    };
  });

  // 计算每天的 job runs
  const dayJobsMap: Record<number, CalendarRunItem[]> = {};
  for (let i = 0; i < 7; i++) dayJobsMap[i] = [];

  for (const job of jobs.filter((j) => j.enabled)) {
    const runs = getJobRunsIn7Days(job);
    for (const run of runs) {
      if (dayJobsMap[run.dayIndex] !== undefined) {
        dayJobsMap[run.dayIndex].push({
          job,
          timeLabel: run.timeLabel,
          ts: run.ts,
          status: run.status ?? "scheduled",
        });
      }
    }
  }

  // 每天按时间排序
  for (const i of Object.keys(dayJobsMap)) {
    dayJobsMap[Number(i)].sort((a, b) => a.ts - b.ts);
  }

  return (
    <>
      {selectedItem && (
        <CalendarDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {days.map((day) => {
            const dayRuns = dayJobsMap[day.dayIndex] ?? [];
            return (
              <div
                key={day.dayIndex}
                className={cn(
                  "flex min-h-[160px] flex-col rounded-lg border p-2",
                  day.isToday
                    ? "border-blue-400 bg-blue-50/40 shadow-sm"
                    : "border-slate-200 bg-slate-50/50",
                )}
              >
                {/* 日期头 */}
                <div
                  className={cn(
                    "mb-1.5 border-b pb-1.5 text-center text-xs font-semibold",
                    day.isToday
                      ? "border-blue-200 text-blue-700"
                      : "border-slate-200 text-slate-600",
                  )}
                >
                  {day.label}
                  {day.isToday && (
                    <span className="ml-1 rounded-full bg-blue-600 px-1 py-0.5 text-[9px] text-white">
                      今
                    </span>
                  )}
                </div>

                {/* Job 条目 */}
                <div className="flex-1 space-y-1 overflow-y-auto">
                  {dayRuns.length === 0 ? (
                    <div className="py-3 text-center text-[9px] text-slate-400">
                      —
                    </div>
                  ) : (
                    dayRuns.map((run, idx) => {
                      const agentName = extractAgentName(
                        run.job.sessionKey,
                        run.job.agentId,
                        run.job.agent_name,
                      );
                      const color = getAgentColor(agentName);
                      return (
                        <button
                          key={`${run.job.id}-${idx}`}
                          onClick={() => setSelectedItem(run)}
                          className={cn(
                            "w-full rounded border px-1.5 py-1 text-left text-[9px] leading-tight transition hover:opacity-80 hover:shadow-sm",
                            color,
                          )}
                          title={`${agentName}: ${run.job.name}\n${run.timeLabel} · ${getStatusLabel(run.status)}`}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                getStatusDotClass(run.status),
                              )}
                            />
                            <span className="font-bold">{run.timeLabel}</span>
                          </div>
                          <div className="mt-0.5 truncate opacity-80">
                            {agentName}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* 底部统计 */}
                {dayRuns.length > 0 && (
                  <div className="mt-1 border-t border-slate-200/60 pt-1 text-center text-[8px] text-slate-400">
                    {dayRuns.length} 次
                    {dayRuns.filter((r) => r.status === "error").length > 0 && (
                      <span className="ml-1 text-rose-400">
                        {dayRuns.filter((r) => r.status === "error").length}{" "}
                        失败
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ------ Page ------
type ViewMode = "list" | "calendar";

export default function CronsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [enabledFilter, setEnabledFilter] = useState<string>("all");

  const cronsQuery = useQuery<CronsResponse, ApiError>({
    queryKey: ["crons", "jobs"],
    queryFn: fetchCronJobs,
    enabled: true,
    refetchInterval: 30_000,
  });

  const allJobs = cronsQuery.data?.jobs ?? [];

  // Derive distinct agent names for filter dropdown
  const agentOptions = Array.from(
    new Set(
      allJobs.map((j) =>
        extractAgentName(j.sessionKey, j.agentId, j.agent_name),
      ),
    ),
  ).filter(Boolean);

  // Apply filters
  const filteredJobs = allJobs.filter((job) => {
    if (agentFilter !== "all") {
      const label = extractAgentName(
        job.sessionKey,
        job.agentId,
        job.agent_name,
      );
      if (label !== agentFilter) return false;
    }
    if (statusFilter !== "all") {
      const s = (job.state?.lastStatus ?? "").toLowerCase();
      if (s !== statusFilter) return false;
    }
    if (enabledFilter !== "all") {
      const want = enabledFilter === "enabled";
      if (job.enabled !== want) return false;
    }
    return true;
  });

  const enabledCount = allJobs.filter((j) => j.enabled).length;
  const disabledCount = allJobs.length - enabledCount;
  const errorCount = allJobs.filter(
    (j) => j.state?.lastStatus === "error",
  ).length;

  return (
    <DashboardShell>
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <div className="p-4 md:p-8">
          {cronsQuery.error ? (
            <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
              Failed to load cron jobs: {cronsQuery.error.message}
            </div>
          ) : null}

          {/* Stats row */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total Jobs
              </p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {allJobs.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                启用
              </p>
              <p className="mt-2 text-3xl font-bold text-emerald-600">
                {enabledCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                禁用
              </p>
              <p className="mt-2 text-3xl font-bold text-slate-400">
                {disabledCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                最近失败
              </p>
              <p
                className={cn(
                  "mt-2 text-3xl font-bold",
                  errorCount > 0 ? "text-rose-500" : "text-slate-400",
                )}
              >
                {errorCount}
              </p>
            </div>
          </div>

          {/* View toggle + filters */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* View mode toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  viewMode === "list"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <List className="h-3.5 w-3.5" />
                列表视图
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  viewMode === "calendar"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                7天日历
              </button>
            </div>

            {/* Filters (only shown in list mode) */}
            {viewMode === "list" && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Agent Filter */}
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                    <Filter className="h-3 w-3 text-slate-400" />
                  </div>
                  <select
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    className="cursor-pointer appearance-none rounded border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                  >
                    <option value="all">All Agents</option>
                    {agentOptions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  </div>
                </div>

                {/* Status Filter */}
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                    <Filter className="h-3 w-3 text-slate-400" />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="cursor-pointer appearance-none rounded border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                  >
                    <option value="all">All Status</option>
                    <option value="ok">OK</option>
                    <option value="skipped">Skipped</option>
                    <option value="error">Error</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  </div>
                </div>

                {/* Enabled Filter */}
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                    <Filter className="h-3 w-3 text-slate-400" />
                  </div>
                  <select
                    value={enabledFilter}
                    onChange={(e) => setEnabledFilter(e.target.value)}
                    className="cursor-pointer appearance-none rounded border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                  >
                    <option value="all">启用/禁用</option>
                    <option value="enabled">仅启用</option>
                    <option value="disabled">仅禁用</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  </div>
                </div>

                <span className="text-xs text-slate-500">
                  {filteredJobs.length} / {allJobs.length}
                </span>
              </div>
            )}
          </div>

          {/* List view */}
          {viewMode === "list" && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Clock className="h-5 w-5 text-slate-400" />
                定时任务列表
              </h3>
              <div className="space-y-2">
                {cronsQuery.isLoading ? (
                  <div className="flex h-[200px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    Loading cron jobs...
                  </div>
                ) : filteredJobs.length > 0 ? (
                  filteredJobs.map((job) => (
                    <CronJobRow key={job.id} job={job} />
                  ))
                ) : (
                  <div className="flex h-[200px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    <Clock className="mb-2 h-8 w-8 text-slate-400" />
                    No cron jobs found
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Calendar view */}
          {viewMode === "calendar" && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <CalendarDays className="h-5 w-5 text-slate-400" />7
                  天日历视图
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  显示未来 7 天内各 Cron Job 的执行计划（北京时间）·
                  点击格子查看详情
                </p>
              </div>
              {cronsQuery.isLoading ? (
                <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">
                  Loading...
                </div>
              ) : (
                <WeekCalendarView jobs={allJobs} />
              )}
            </section>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}
