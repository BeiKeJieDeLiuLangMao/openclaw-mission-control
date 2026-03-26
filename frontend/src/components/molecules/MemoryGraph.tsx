"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Network, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Dynamically import ForceGraph2D (WebGL, heavy — no SSR)
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// ------ Types ------
interface GraphRelation {
  source: string;
  relationship: string;
  target: string;
}

interface GraphResponse {
  relations: GraphRelation[];
  total: number;
}

interface GraphStats {
  nodes: number;
  relations: number;
  relation_types: Array<{ rel_type: string; cnt: number }>;
}

interface GraphAgentsResponse {
  agents: Array<{ agent_id: string; label: string; node_count: number }>;
}

interface NodeObject {
  id: string;
  name: string;
  val: number;
  x?: number;
  y?: number;
}

interface LinkObject {
  source: string;
  target: string;
  relationship: string;
}

interface GraphData {
  nodes: NodeObject[];
  links: LinkObject[];
}

// ------ API ------
const MEM0_API = process.env.NEXT_PUBLIC_MEM0_API ?? "http://localhost:8765";

const fetchGraph = async (userId: string): Promise<GraphResponse> => {
  const res = await fetch(`${MEM0_API}/api/v1/graph?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Graph API failed: ${res.statusText}`);
  return res.json();
};

const fetchGraphSearch = async (q: string, userId: string): Promise<GraphResponse> => {
  const res = await fetch(
    `${MEM0_API}/api/v1/graph/search?q=${encodeURIComponent(q)}&user_id=${encodeURIComponent(userId)}`
  );
  if (!res.ok) throw new Error(`Graph search failed: ${res.statusText}`);
  return res.json();
};

const fetchGraphStats = async (userId: string): Promise<GraphStats> => {
  const res = await fetch(`${MEM0_API}/api/v1/graph/stats?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Graph stats API failed: ${res.statusText}`);
  return res.json();
};

const fetchGraphAgents = async (userId: string): Promise<GraphAgentsResponse> => {
  const res = await fetch(`${MEM0_API}/api/v1/graph/agents?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Graph agents API failed: ${res.statusText}`);
  return res.json();
};

// ------ Color by relationship type ------
const REL_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#10b981",
  "#f59e0b", "#ef4444", "#06b6d4", "#84cc16",
];

function relColor(rel: string): string {
  let hash = 0;
  for (let i = 0; i < rel.length; i++) {
    hash = (hash * 31 + rel.charCodeAt(i)) >>> 0;
  }
  return REL_COLORS[hash % REL_COLORS.length];
}

// ------ Build graph data ------
function buildGraphData(relations: GraphRelation[]): GraphData {
  const nodeMap = new Map<string, NodeObject>();
  const links: LinkObject[] = [];

  for (const r of relations) {
    if (!nodeMap.has(r.source)) {
      nodeMap.set(r.source, { id: r.source, name: r.source, val: 1 });
    }
    if (!nodeMap.has(r.target)) {
      nodeMap.set(r.target, { id: r.target, name: r.target, val: 1 });
    }
    nodeMap.get(r.source)!.val++;
    nodeMap.get(r.target)!.val++;
    links.push({ source: r.source, target: r.target, relationship: r.relationship });
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

// ------ Node label ------
function nodeLabel(node: any): string {
  const name: string = node.name ?? node.id ?? "";
  return name.length > 40 ? name.slice(0, 40) + "…" : name;
}

// ------ Props ------
interface MemoryGraphProps {
  userId: string;
  className?: string;
}

// ------ StatCard ------
function MiniStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("text-lg font-bold", accent ?? "text-slate-800")}>{value.toLocaleString()}</p>
    </div>
  );
}

// ------ Component ------
export function MemoryGraph({ userId, className }: MemoryGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [agentList, setAgentList] = useState<Array<{ agent_id: string; label: string; node_count: number }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedRelTypes, setSelectedRelTypes] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // The actual user_id to query
  const queryUserId = selectedAgent || userId;

  // Load all data
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [graphRes, statsRes] = await Promise.all([
        fetchGraph(queryUserId),
        fetchGraphStats(queryUserId),
      ]);
      setGraphData(buildGraphData(graphRes.relations));
      setStats(statsRes);
      // Reset filters when data changes
      setSelectedRelTypes([]);
      setSearchQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [queryUserId]);

  // Load agent list on mount
  useEffect(() => {
    fetchGraphAgents(userId)
      .then((res) => setAgentList(res.agents))
      .catch(() => {/* non-critical */});
  }, [userId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Zoom to fit on data change
  useEffect(() => {
    if (graphData.nodes.length > 0 && graphRef.current) {
      const timer = setTimeout(() => graphRef.current?.zoomToFit?.(400, 40), 100);
      return () => clearTimeout(timer);
    }
  }, [graphData]);

  // Search
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadGraph();
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const res = await fetchGraphSearch(searchQuery, queryUserId);
      setGraphData(buildGraphData(res.relations));
      if (stats) {
        setStats({ ...stats, nodes: buildGraphData(res.relations).nodes.length, relations: res.total });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Filter by relationship types (client-side highlight only)
  const toggleRelType = (rel: string) => {
    setSelectedRelTypes((prev) =>
      prev.includes(rel) ? prev.filter((r) => r !== rel) : [...prev, rel]
    );
  };

  // Canvas: highlight selected rel types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = nodeLabel(node);
    const fontSize = Math.max(10 / globalScale, 3);
    const radius = Math.sqrt(node.val ?? 1) * 3 + 4;

    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = selectedRelTypes.length > 0 ? "#94a3b8" : "#6366f1";
    ctx.fill();

    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1e293b";
    ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius + fontSize);
  }, [selectedRelTypes]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback((link: any): string => {
    const rel: string = link.relationship ?? "";
    const color = relColor(rel);
    return selectedRelTypes.length === 0 || selectedRelTypes.includes(rel) ? color : `${color}33`;
  }, [selectedRelTypes]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any): number => {
    const rel: string = link.relationship ?? "";
    return selectedRelTypes.includes(rel) ? 2.5 : 0.5;
  }, [selectedRelTypes]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden",
        className,
      )}
    >
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-700">知识图谱</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadGraph}
          disabled={loading}
          className="h-7 w-7 p-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* ---- Dashboard Stats ---- */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <MiniStatCard label="节点数" value={stats.nodes} />
          <MiniStatCard label="关系数" value={stats.relations} />
          <MiniStatCard
            label="关系类型"
            value={stats.relation_types.length}
          />
        </div>
      )}

      {/* ---- Filter Bar ---- */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        {/* Agent selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Agent:</span>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">全部</option>
            {agentList.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.label} ({a.node_count})
              </option>
            ))}
          </select>
        </div>

        {/* Relation type chips */}
        {stats && stats.relation_types.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">关系:</span>
            <div className="flex flex-wrap gap-1">
              {stats.relation_types.slice(0, 12).map((rt) => {
                const active = selectedRelTypes.includes(rt.rel_type);
                return (
                  <button
                    key={rt.rel_type}
                    onClick={() => toggleRelType(rt.rel_type)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs transition",
                      active
                        ? "text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                    style={active ? { backgroundColor: relColor(rt.rel_type) } : {}}
                  >
                    {rt.rel_type} ({rt.cnt})
                  </button>
                );
              })}
              {selectedRelTypes.length > 0 && (
                <button
                  onClick={() => setSelectedRelTypes([])}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-200"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- Search Bar ---- */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索节点名称或关系类型…"
          className="flex-1 text-sm text-slate-700 placeholder-slate-400 outline-none"
        />
        {isSearching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {searchQuery && (
          <button onClick={() => { setSearchQuery(""); loadGraph(); }} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <Button size="sm" variant="outline" onClick={handleSearch} disabled={isSearching} className="h-7 text-xs">
          搜索
        </Button>
      </div>

      {/* ---- Graph Canvas ---- */}
      <div className="relative min-h-[400px]">
        {loading && graphData.nodes.length === 0 ? (
          <div className="flex h-[400px] items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-sm text-slate-400">暂无图谱数据</p>
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData as any}
            nodeId="id"
            nodeLabel={nodeLabel}
            nodeVal={(node: any) => Math.sqrt(node.val ?? 1) * 3 + 4}
            nodeColor={() => "#6366f1"}
            nodeCanvasObject={nodeCanvasObject}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkLabel={(link: any) => link.relationship ?? ""}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={0.9}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            backgroundColor="#f8fafc"
          />
        )}

        {/* Legend */}
        {stats && stats.relation_types.length > 0 && (
          <div className="absolute bottom-2 right-2 flex max-w-[160px] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-slate-100 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
            {stats.relation_types.slice(0, 8).map((rt) => (
              <div key={rt.rel_type} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: relColor(rt.rel_type) }}
                />
                <span className="text-xs text-slate-500">{rt.rel_type}</span>
              </div>
            ))}
            {stats.relation_types.length > 8 && (
              <span className="text-xs text-slate-400">+{stats.relation_types.length - 8} 更多</span>
            )}
          </div>
        )}

        {/* Highlighted filter indicator */}
        {selectedRelTypes.length > 0 && (
          <div className="absolute left-2 top-2 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 text-xs text-slate-500 shadow-sm backdrop-blur-sm">
            已高亮: {selectedRelTypes.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
