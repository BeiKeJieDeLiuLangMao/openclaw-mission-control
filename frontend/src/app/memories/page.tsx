"use client";

export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Brain, Search, Plus, Trash2, RefreshCw, Bot, Filter } from "lucide-react";

import { DashboardShell } from "@/components/templates/DashboardShell";
import { DashboardSidebar } from "@/components/organisms/DashboardSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/auth/clerk";
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import { cn } from "@/lib/utils";

// mem0 server API base
const MEM0_API = "http://localhost:8765";

// ------ Types ------
interface MemoryItem {
  id: string;
  memory: string;
  score?: number;
  metadata: Record<string, unknown>;
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
}): Promise<MemoryItem[]> => {
  const url = new URL(`${MEM0_API}/api/v1/memories`);
  url.searchParams.set("user_id", params.userId ?? "yishu");
  if (params.agentId) url.searchParams.set("agent_id", params.agentId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch memories: ${res.statusText}`);
  return res.json();
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
  return res.json();
};

// Derive stats from memories list (mem0 has no /stats endpoint, 兼容驼峰和下划线)
function deriveStats(memories: MemoryItem[]): MemoryStats {
  const by_source: Record<string, number> = {};
  const by_agent: Record<string, number> = {};
  for (const m of memories) {
    const src = String(m.metadata?.source ?? "unknown");
    by_source[src] = (by_source[src] ?? 0) + 1;
    const agentId = String(m.metadata?.agentId ?? m.metadata?.agent_id ?? "unknown");
    by_agent[agentId] = (by_agent[agentId] ?? 0) + 1;
  }
  return {
    total: memories.length,
    by_source,
    by_agent: Object.entries(by_agent).map(([agent_id, count]) => ({ agent_id, count })),
  };
}

// Derive agent list from memories (兼容驼峰和下划线两种格式)
function deriveAgents(memories: MemoryItem[]): AgentInfo[] {
  const countMap: Record<string, number> = {};
  for (const m of memories) {
    // 兼容 OpenClaw 插件存入的 agentId（驼峰）和 server.py 存入的 agent_id（下划线）
    const agentId = String(m.metadata?.agentId ?? m.metadata?.agent_id ?? "unknown");
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
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
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

// ------ Memory Card ------
function MemoryCard({
  memory,
  onDelete,
}: {
  memory: MemoryItem;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

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
            {truncate(memory.memory, 300)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(!!memory.metadata?.agent_id || !!memory.metadata?.agentId) && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Bot className="h-3 w-3" />
                {String(memory.metadata!.agentId ?? memory.metadata!.agent_id)}
              </Badge>
            )}
            {!!memory.metadata?.source && (
              <Badge variant="accent" className="text-xs">
                {String(memory.metadata!.source)}
              </Badge>
            )}
            {memory.score !== undefined && (
              <Badge variant="outline" className="text-xs">
                {(memory.score * 100).toFixed(0)}%
              </Badge>
            )}
            {!!memory.metadata?.created_at && (
              <span className="text-xs text-slate-400">
                {formatDate(String(memory.metadata!.created_at))}
              </span>
            )}
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
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedMemories = useMemo(() => {
    return [...memories].sort((a, b) => {
      const aTime = a.metadata?.created_at
        ? new Date(String(a.metadata.created_at)).getTime()
        : 0;
      const bTime = b.metadata?.created_at
        ? new Date(String(b.metadata.created_at)).getTime()
        : 0;
      return bTime - aTime;
    });
  }, [memories]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [addingMemory, setAddingMemory] = useState(false);

  const userId = "yishu";

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // mem0 has no /stats or /agents endpoints; derive from memories list
      const data = await fetchMemories({ userId, agentId: selectedAgent });
      setMemories(data);
      setStats(deriveStats(data));
      setAgents(deriveAgents(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [userId, selectedAgent]);

  const loadMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchMemories({ userId, agentId: selectedAgent });
      setMemories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setIsLoading(false);
    }
  }, [userId, selectedAgent]);

  // Initial load
  useEffect(() => {
    loadData();
    loadMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedAgent]);

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
                  将添加到 Agent: {selectedAgent}
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
          ) : stats ? (
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

          {/* Agent Filter */}
          {agents.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <AgentFilter
                agents={agents}
                selected={selectedAgent}
                onSelect={(agentId) => {
                  setSelectedAgent(agentId);
                  setTimeout(async () => {
                    try {
                      const data = await fetchMemories({ userId, agentId });
                      setMemories(data);
                      setStats(deriveStats(data));
                    } catch { /* loadData will handle error */ }
                  }, 0);
                }}
              />
            </div>
          )}

          {/* Search */}
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

          {/* Memory List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                记忆列表 ({sortedMemories.length})
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
            ) : sortedMemories.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                {searchQuery ? "未找到匹配的记忆" : "暂无记忆，使用上方搜索框添加"}
              </div>
            ) : (
              <div className="space-y-3">
                {sortedMemories.map((memory: MemoryItem) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    onDelete={handleDeleteMemory}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </DashboardShell>
  );
}
