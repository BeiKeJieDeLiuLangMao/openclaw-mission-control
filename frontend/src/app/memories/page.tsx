"use client";

export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect } from "react";
import { Brain, Search, Plus, Trash2, RefreshCw, Bot, Filter } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DashboardShell } from "@/components/templates/DashboardShell";
import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { Button } from "@/components/ui/button";
import { AILearnView } from "@/components/molecules/AILearnView";
import { MemoryGraph } from "@/components/molecules/MemoryGraph";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/auth/clerk";
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import { cn } from "@/lib/utils";

// mem0 server API base
const MEM0_API = process.env.NEXT_PUBLIC_API_URL === 'auto'
  ? `${window.location.protocol}//${window.location.hostname}:8765`
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8765');

// ------ Types ------
interface MemoryItem {
  id: string;
  content: string;  // Changed from 'memory' to 'content' to match OpenMemory API
  created_at: number;
  state: string;
  app_name?: string;
  categories: string[];
  metadata__?: Record<string, unknown>;  // Qdrant payload metadata
  score?: number;  // For search results
  turn_id?: string | null;  // 关联的 turn ID
  agent_id?: string;  // 顶层 agent_id 字段
  memory_type?: string;  // 顶层 memory_type 字段
  source?: string;  // 顶层 source 字段（从 turns 表关联获取）
  userId?: string;  // Qdrant payload 中的 userId 字段
  agentId?: string;  // Qdrant payload 中的 agentId 字段
}

interface SourceInfo {
  source_id: string;  // 来源标识: claude-code, openclaw, manual
  label: string;  // 显示标签
  count: number;
}

interface MemoryStats {
  total: number;
  by_source: Record<string, number>;
  by_agent: Array<{ agent_id: string; count: number }>;
}

interface AgentInfo {
  agent_id: string;
  count: number;
}

// ------ API ------
const fetchMemories = async (params: {
  userId?: string;
  agentId?: string;
  source?: string;  // 按来源筛选
}): Promise<MemoryItem[]> => {
  const url = new URL(`${MEM0_API}/api/v1/memories`);
  url.searchParams.set("user_id", params.userId ?? "yishu");
  if (params.agentId) url.searchParams.set("agent_id", params.agentId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch memories: ${res.statusText}`);
  const data = await res.json();
  let items = data.items || data;

  // 客户端来源筛选（因为 API 没有按 source 筛选的参数）
  if (params.source) {
    items = items.filter((m: MemoryItem) => inferSource(m) === params.source);
  }

  // 按时间倒序排序（最新的在前）
  items.sort((a: MemoryItem, b: MemoryItem) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return timeB - timeA;  // 倒序：b - a
  });

  // 处理 Qdrant payload 结构
  // API 返回: { content, metadata: { userId, agentId, data, ... } } (metadata 一个下划线)
  // TypeScript 接口用: metadata__ (两个下划线)
  return items.map((m: MemoryItem) => {
    // API 返回的 metadata 在 m.metadata 中（一个下划线）
    const apiMetadata = ((m as unknown) as Record<string, unknown>).metadata as Record<string, unknown> || {};
    return {
      ...m,
      // content 可能在顶层或 metadata.data 中
      content: m.content || String(apiMetadata.data || ""),
      // 从 metadata 中提取 userId 和 agentId
      userId: String(apiMetadata.userId || m.userId || ""),
      agentId: String(apiMetadata.agentId || m.agentId || ""),
      // 统一放到 metadata__ 中（两个下划线）
      metadata__: apiMetadata,
    };
  });
};

const searchMemories = async (params: {
  query: string;
  userId?: string;
  agentId?: string;
  limit?: number;
}): Promise<MemoryItem[]> => {
  const url = new URL(`${MEM0_API}/api/v1/memories/search`);
  url.searchParams.set("query", params.query);
  url.searchParams.set("user_id", params.userId ?? "yishu");
  url.searchParams.set("limit", String(params.limit ?? 20));
  if (params.agentId) url.searchParams.set("agent_id", params.agentId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to search memories: ${res.statusText}`);
  const data = await res.json();
  // Handle both array and paginated response
  return data.items || data;
};

// 从数据中推断记忆来源（优先使用 API 返回的 source 字段）
function inferSource(m: MemoryItem): string {
  // 1. 优先使用 API 返回的 source 字段（现在已正确实现）
  if (m.source && m.source !== "manual") {
    return m.source;
  }

  // 2. 如果 API 返回 "manual"，检查是否有 agent_id 判断真实来源
  if (m.source === "manual" && m.agent_id && m.agent_id !== "unknown") {
    // 如果有 agent_id 但 source 是 manual，可能是新添加的记忆
    return "manual";
  }

  // 3. 从 metadata 中提取 agentId/userId 推断来源（兼容旧数据）
  const metadata = m.metadata__ as Record<string, unknown> | undefined;
  const userId = String(metadata?.userId || m.userId || "");
  const agentId = String(metadata?.agentId || m.agentId || m.agent_id || "");

  // 根据 agentId 特点判断来源
  if (agentId.startsWith("mc-")) {
    // mc- 前缀是 Mission Control 管理的 agent，属于 OpenClaw
    return "openclaw";
  }

  if (userId.includes("claude-code") || agentId.includes("claude-code")) {
    return "claude-code";
  }

  if (agentId === "main" || agentId.startsWith("lead-")) {
    // main 和 lead- 是 OpenClaw 的默认 agent
    return "openclaw";
  }

  // 默认为手工（手动添加）
  return "manual";
}

// Derive source list from memories
function deriveSources(memories: MemoryItem[]): SourceInfo[] {
  const countMap: Record<string, number> = {};
  for (const m of memories) {
    const src = inferSource(m);
    countMap[src] = (countMap[src] ?? 0) + 1;
  }

  // 定义来源顺序和标签
  const sourceLabels: Record<string, string> = {
    "claude-code": "Claude Code",
    "openclaw": "OpenClaw",
    "conversation": "对话",
    "manual": "手工",
    "unknown": "未知",
  };

  return Object.entries(countMap)
    .map(([source_id, count]) => ({
      source_id,
      label: sourceLabels[source_id] || source_id,
      count,
    }))
    .sort((a, b) => {
      // 按固定顺序排序
      const order = ["claude-code", "openclaw", "conversation", "manual", "unknown"];
      return order.indexOf(a.source_id) - order.indexOf(b.source_id);
    });
}

// Derive stats from memories list (mem0 has no /stats endpoint)
function deriveStats(memories: MemoryItem[]): MemoryStats {
  const by_source: Record<string, number> = {};
  const by_agent: Record<string, number> = {};
  for (const m of memories) {
    // 使用 inferSource 推断来源
    const src = inferSource(m);
    by_source[src] = (by_source[src] ?? 0) + 1;

    // agent_id 优先使用顶层字段，其次 metadata
    const agentId = m.agentId || String(m.agent_id || m.metadata__?.agentId || "unknown");
    by_agent[agentId] = (by_agent[agentId] ?? 0) + 1;
  }
  return {
    total: memories.length,
    by_source,
    by_agent: Object.entries(by_agent).map(([agent_id, count]) => ({ agent_id, count })),
  };
}

// Derive agent list from memories
function deriveAgents(memories: MemoryItem[]): AgentInfo[] {
  const countMap: Record<string, number> = {};
  for (const m of memories) {
    // 从 metadata 中提取 agentId（API 返回的结构）
    const metadata = m.metadata__ as Record<string, unknown> | undefined;
    const agentId = String(
      metadata?.agentId || m.agentId || m.agent_id || "unknown"
    );
    countMap[agentId] = (countMap[agentId] ?? 0) + 1;
  }
  return Object.entries(countMap).map(([agent_id, count]) => ({ agent_id, count }));
}

const addMemory = async (params: {
  text: string;
  userId?: string;
  agentId?: string;
}): Promise<{ id: string; status: string }> => {
  const res = await fetch(`${MEM0_API}/api/v1/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      user_id: params.userId ?? "yishu",
      agent_id: params.agentId,
    }),
  });
  if (!res.ok) throw new Error(`Failed to add memory: ${res.statusText}`);
  return res.json();
};

const deleteMemory = async (memoryId: string): Promise<void> => {
  const res = await fetch(`${MEM0_API}/api/v1/memories/${memoryId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete memory: ${res.statusText}`);
};

// ------ Helpers ------
function formatDate(dateStr: unknown): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(String(dateStr));
    return d.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return String(dateStr);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ------ Stat Card ------
function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={cn("mt-2 text-3xl font-bold", accent ?? "text-slate-900")}>
        {value.toLocaleString()}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// 来源标签映射
const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "openclaw": "OpenClaw",
  "conversation": "对话",
  "manual": "手工",
  "unknown": "未知",
};

// 来源对应的颜色
const SOURCE_COLORS: Record<string, string> = {
  "claude-code": "bg-purple-100 text-purple-700 border-purple-200",
  "openclaw": "bg-blue-100 text-blue-700 border-blue-200",
  "conversation": "bg-green-100 text-green-700 border-green-200",
  "manual": "bg-slate-100 text-slate-700 border-slate-200",
  "unknown": "bg-gray-100 text-gray-700 border-gray-200",
};

// ------ Memory Card ------
function MemoryCard({
  memory,
  onDelete,
}: {
  memory: MemoryItem;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const source = inferSource(memory);
  const sourceLabel = SOURCE_LABELS[source] || source;
  const sourceColor = SOURCE_COLORS[source] || SOURCE_COLORS["unknown"];

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteMemory(memory.id);
      onDelete(memory.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-slate-700">
            {truncate(memory.content, 300)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* 来源 Badge */}
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", sourceColor)}>
              {sourceLabel}
            </span>
            {/* Agent Badge */}
            {(() => {
              const metadata = memory.metadata__ as Record<string, unknown> | undefined;
              const agentId = memory.agentId || memory.agent_id || String(metadata?.agentId || "");
              return agentId ? (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Bot className="h-3 w-3" />
                  {agentId}
                </Badge>
              ) : null;
            })()}
            {/* 搜索得分 */}
            {memory.score != null && memory.score !== undefined && (
              <Badge variant="outline" className="text-xs">
                {(memory.score * 100).toFixed(0)}%
              </Badge>
            )}
            <span className="text-xs text-slate-400">
              {formatDate(memory.created_at)}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 text-slate-400 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ------ Source Filter ------
function SourceFilter({
  sources,
  selected,
  onSelect,
}: {
  sources: SourceInfo[];
  selected?: string;
  onSelect: (source?: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">来源:</span>
      <button
        onClick={() => onSelect(undefined)}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition",
          !selected
            ? "bg-blue-500 text-white"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200",
        )}
      >
        全部
      </button>
      {sources.map((src) => {
        const colorClass = SOURCE_COLORS[src.source_id] || SOURCE_COLORS["unknown"];
        return (
          <button
            key={src.source_id}
            onClick={() => onSelect(src.source_id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              selected === src.source_id
                ? "bg-blue-500 text-white"
                : colorClass,
            )}
          >
            {src.label} ({src.count})
          </button>
        );
      })}
    </div>
  );
}

// ------ Agent Filter ------
function AgentFilter({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentInfo[];
  selected?: string;
  onSelect: (agentId?: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-4 w-4 text-slate-400" />
      <button
        onClick={() => onSelect(undefined)}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition",
          !selected
            ? "bg-blue-500 text-white"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200",
        )}
      >
        All
      </button>
      {agents.map((agent) => (
        <button
          key={agent.agent_id}
          onClick={() => onSelect(agent.agent_id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition",
            selected === agent.agent_id
              ? "bg-blue-500 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
          )}
        >
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            {agent.agent_id} ({agent.count})
          </span>
        </button>
      ))}
    </div>
  );
}

// ------ Main Page ------
export default function MemoriesPage() {
  const { isSignedIn } = useAuth();
  const { isAdmin } = useOrganizationMembership(isSignedIn);

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [addingMemory, setAddingMemory] = useState(false);
  const [view, setView] = useState<"list" | "graph" | "ailearn">("list");

  const userId = "yishu";

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // mem0 has no /stats or /agents endpoints; derive from memories list
      const data = await fetchMemories({ userId, agentId: selectedAgent, source: selectedSource });
      setMemories(data);
      setStats(deriveStats(data));
      setAgents(deriveAgents(data));
      setSources(deriveSources(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [userId, selectedAgent, selectedSource]);

  const loadMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchMemories({ userId, agentId: selectedAgent, source: selectedSource });
      setMemories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setIsLoading(false);
    }
  }, [userId, selectedAgent, selectedSource]);

  // Initial load and re-load when filters change
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedAgent, selectedSource]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadMemories();
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const results = await searchMemories({
        query: searchQuery,
        userId,
        agentId: selectedAgent,
        limit: 20,
      });
      setMemories(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddMemory = async () => {
    if (!newMemoryText.trim()) return;
    setAddingMemory(true);
    setError(null);
    try {
      await addMemory({
        text: newMemoryText,
        userId,
        agentId: selectedAgent,
      });
      setNewMemoryText("");
      setShowAddForm(false);
      await Promise.all([loadData(), loadMemories()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add memory");
    } finally {
      setAddingMemory(false);
    }
  };

  const handleDeleteMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    loadData();
  };

  if (!isAdmin) {
    return (
      <DashboardShell>
        <DashboardSidebar />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex h-full items-center justify-center">
            <p className="text-slate-500">Only admins can access memories.</p>
          </div>
        </main>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <div className="p-4 md:p-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="h-6 w-6 text-blue-500" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">记忆管理</h1>
                <p className="text-sm text-slate-500">Agent 记忆隔离 · 向量搜索</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={view} onValueChange={(v) => setView(v as "list" | "graph" | "ailearn")}>
                <TabsList className="h-8">
                  <TabsTrigger value="list" className="text-xs">列表</TabsTrigger>
                  <TabsTrigger value="graph" className="text-xs">图谱</TabsTrigger>
                  <TabsTrigger value="ailearn" className="text-xs">AI 学习</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                variant="outline"
                size="sm"
                onClick={() => Promise.all([loadData(), loadMemories()])}
                disabled={isLoading}
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
              <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="h-4 w-4" />
                添加记忆
              </Button>
            </div>
          </div>

          {/* Graph View */}
          {view === "graph" && (
            <MemoryGraph userId={userId} />
          )}

          {/* AI Learning View */}
          {view === "ailearn" && <AILearnView />}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Add Memory Form */}
          {showAddForm && (
            <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">添加新记忆</h3>
              <div className="flex gap-2">
                <Input
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  placeholder="输入要记住的内容..."
                  onKeyDown={(e) => e.key === "Enter" && handleAddMemory()}
                  className="flex-1"
                />
                <Button onClick={handleAddMemory} disabled={addingMemory || !newMemoryText.trim()}>
                  {addingMemory ? "添加中…" : "保存"}
                </Button>
                <Button variant="ghost" onClick={() => setShowAddForm(false)}>
                  取消
                </Button>
              </div>
              {selectedAgent && (
                <p className="mt-2 text-xs text-slate-500">
                  将添加到 Agent: {selectedAgent.slice(0, 8)}…
                </p>
              )}
            </div>
          )}

          {/* Stats */}
          {isLoading && !stats ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm"
                />
              ))}
            </div>
          ) : stats && view === "list" ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="总记忆数" value={stats.total} />
              <StatCard
                label="来源"
                value={Object.keys(stats.by_source).length}
                sub={Object.entries(stats.by_source)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              />
              <StatCard label="Agent 数" value={stats.by_agent.length} />
              <StatCard
                label="当前筛选"
                value={selectedAgent ? 1 : 0}
                accent={selectedAgent ? "text-blue-500" : undefined}
                sub={selectedAgent ?? "全部"}
              />
            </div>
          ) : null}

          {/* Source Filter */}
          {sources.length > 0 && view === "list" && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <SourceFilter
                sources={sources}
                selected={selectedSource}
                onSelect={(source) => setSelectedSource(source)}
              />
            </div>
          )}

          {/* Agent Filter */}
          {agents.length > 0 && view === "list" && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <AgentFilter
                agents={agents}
                selected={selectedAgent}
                onSelect={(agentId) => setSelectedAgent(agentId)}
              />
            </div>
          )}

          {/* Search */}
          {view === "list" && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索记忆内容..."
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-10"
                />
              </div>
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? "搜索中…" : "搜索"}
              </Button>
              {searchQuery && (
                <Button variant="ghost" onClick={() => { setSearchQuery(""); loadMemories(); }}>
                  清除
                </Button>
              )}
            </div>
          </div>
          )}

          {/* Memory List */}
          {view === "list" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                记忆列表 ({memories.length})
              </h2>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm"
                  />
                ))}
              </div>
            ) : memories.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                {searchQuery ? "未找到匹配的记忆" : "暂无记忆，使用上方搜索框添加"}
              </div>
            ) : (
              <div className="space-y-3">
                {memories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    onDelete={handleDeleteMemory}
                  />
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}
