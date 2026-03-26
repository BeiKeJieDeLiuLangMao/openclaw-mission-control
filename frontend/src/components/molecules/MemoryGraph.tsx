"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Network, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
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

interface NodeObject {
  id: string;
  name: string;
  val: number;
  color: string;
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

const fetchGraphStats = async (userId: string): Promise<GraphStats> => {
  const res = await fetch(`${MEM0_API}/api/v1/graph/stats?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Graph stats API failed: ${res.statusText}`);
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
      nodeMap.set(r.source, { id: r.source, name: r.source, val: 1, color: "#94a3b8" });
    }
    if (!nodeMap.has(r.target)) {
      nodeMap.set(r.target, { id: r.target, name: r.target, val: 1, color: "#94a3b8" });
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

// ------ Component ------
export function MemoryGraph({ userId, className }: MemoryGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [graphRes, statsRes] = await Promise.all([fetchGraph(userId), fetchGraphStats(userId)]);
      setGraphData(buildGraphData(graphRes.relations));
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Zoom to fit on data change
  useEffect(() => {
    if (graphData.nodes.length > 0 && graphRef.current) {
      const timer = setTimeout(() => {
        graphRef.current?.zoomToFit?.(400, 40);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [graphData]);

  const handleZoomFit = () => {
    graphRef.current?.zoomToFit?.(400, 40);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = nodeLabel(node);
    const fontSize = Math.max(10 / globalScale, 3);
    const radius = Math.sqrt(node.val ?? 1) * 3 + 4;

    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = hoveredRel ? "#3b82f6" : "#6366f1";
    ctx.fill();

    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1e293b";
    ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius + fontSize);
  }, [hoveredRel]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback((link: any): string => {
    const rel: string = link.relationship ?? "";
    return hoveredRel === rel ? relColor(rel) : `${relColor(rel)}88`;
  }, [hoveredRel]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any): number => {
    return hoveredRel === link.relationship ? 2.5 : 1;
  }, [hoveredRel]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden",
        fullscreen ? "fixed inset-0 z-50 rounded-none" : "h-[520px]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-700">知识图谱</span>
          {stats && (
            <span className="text-xs text-slate-400">
              {stats.nodes} 节点 · {stats.relations} 关系
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Relationship type filter chips */}
          {stats && stats.relation_types.length > 0 && (
            <div className="hidden max-w-xs flex-wrap items-center gap-1 md:flex">
              {stats.relation_types.slice(0, 6).map((rt) => (
                <button
                  key={rt.rel_type}
                  onClick={() => setHoveredRel(hoveredRel === rt.rel_type ? null : rt.rel_type)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs transition",
                    hoveredRel === rt.rel_type
                      ? "text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                  style={hoveredRel === rt.rel_type ? { backgroundColor: relColor(rt.rel_type) } : {}}
                >
                  {rt.rel_type} ({rt.cnt})
                </button>
              ))}
              {stats.relation_types.length > 6 && (
                <span className="text-xs text-slate-400">+{stats.relation_types.length - 6} 更多</span>
              )}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={loadGraph} disabled={loading} className="h-7 w-7 p-0">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleZoomFit} className="h-7 w-7 p-0">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFullscreen((f) => !f)}
            className="h-7 w-7 p-0"
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Legend */}
      {stats && stats.relation_types.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2">
          {stats.relation_types.slice(0, 8).map((rt) => (
            <div key={rt.rel_type} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: relColor(rt.rel_type) }}
              />
              <span className="text-xs text-slate-500">{rt.rel_type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Graph canvas */}
      <div className="flex-1 relative min-h-0">
        {loading && graphData.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
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
      </div>

      {/* Tooltip */}
      {hoveredRel && (
        <div className="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
          <p className="text-xs text-slate-500">高亮关系类型:</p>
          <p className="text-sm font-semibold" style={{ color: relColor(hoveredRel) }}>{hoveredRel}</p>
        </div>
      )}
    </div>
  );
}
