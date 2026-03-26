"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Pause,
  RefreshCw,
  Lightbulb,
  GitBranch,
  FileEdit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

// mem0 server API base
const MEM0_API = process.env.NEXT_PUBLIC_API_URL === 'auto'
  ? `${window.location.protocol}//${window.location.hostname}:8765`
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8765');

// ------ Types ------

interface AILearnStatus {
  is_running: boolean;
  observations_count: number;
  patterns_detected: number;
  skills_extracted: number;
  amendments_proposed: number;
  health_status: string;
  last_analysis: string | null;
  next_analysis: string | null;
}

interface PatternInfo {
  id: string;
  pattern_type: string;
  name: string;
  description: string;
  confidence: number;
  frequency: number;
  extracted_at: string;
}

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  confidence: number;
  extracted_at: string;
}

interface AmendmentInfo {
  id: string;
  amendment_type: string;
  memory_id: string;
  reasoning: string;
  confidence: number;
  expected_impact: number;
  created_at: string;
}

// ------ Helpers ------

function formatConfidence(confidence: number): string {
  return (confidence * 100).toFixed(0) + "%";
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.95) return "text-green-600 bg-green-50 border-green-200";
  if (confidence >= 0.85) return "text-blue-600 bg-blue-50 border-blue-200";
  if (confidence >= 0.7) return "text-yellow-600 bg-yellow-50 border-yellow-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

function getHealthStatusIcon(status: string) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case "unhealthy":
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <RefreshCw className="h-5 w-5 text-slate-400" />;
  }
}

function getPatternTypeIcon(type: string) {
  switch (type) {
    case "workflow_sequence":
      return <GitBranch className="h-4 w-4" />;
    case "user_preference":
      return <Lightbulb className="h-4 w-4" />;
    case "error_recovery":
      return <AlertTriangle className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
}

// ------ Components ------

function StatusCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-2">
            <Icon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-slate-600">{label}</p>
            <p className="text-2xl font-semibold text-slate-900">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PatternCard({ pattern }: { pattern: PatternInfo }) {
  return (
    <Card className="hover:shadow-md transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {getPatternTypeIcon(pattern.pattern_type)}
            <CardTitle className="text-base">{pattern.name}</CardTitle>
          </div>
          <Badge variant="outline" className={getConfidenceColor(pattern.confidence)}>
            {formatConfidence(pattern.confidence)}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {pattern.pattern_type.replace(/_/g, " ")} · {pattern.frequency} 次观察
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-700">{pattern.description}</p>
      </CardContent>
    </Card>
  );
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  return (
    <Card className="hover:shadow-md transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{skill.name}</CardTitle>
          <Badge variant="outline" className={getConfidenceColor(skill.confidence)}>
            {formatConfidence(skill.confidence)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-slate-700">{skill.description}</p>
        {skill.trigger_phrases.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.trigger_phrases.map((phrase, idx) => (
              <Badge key={idx} variant="default" className="text-xs">
                {phrase}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AmendmentCard({ amendment }: { amendment: AmendmentInfo }) {
  const impactColor = amendment.expected_impact > 0 ? "text-green-600" : "text-red-600";
  const impactLabel = amendment.expected_impact > 0 ? "正面" : amendment.expected_impact < 0 ? "负面" : "中性";

  return (
    <Card className="hover:shadow-md transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <FileEdit className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-base">{amendment.amendment_type.replace(/_/g, " ")}</CardTitle>
          </div>
          <Badge variant="outline" className={getConfidenceColor(amendment.confidence)}>
            {formatConfidence(amendment.confidence)}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Memory ID: {amendment.memory_id.slice(0, 8)}...
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-slate-700">{amendment.reasoning}</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">预期影响:</span>
          <span className={`font-medium ${impactColor}`}>{impactLabel}</span>
          <span className="text-slate-400">({(amendment.expected_impact * 100).toFixed(0)}%)</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ------ Main Component ------

export function AILearnView() {
  const [status, setStatus] = useState<AILearnStatus | null>(null);
  const [patterns, setPatterns] = useState<PatternInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [amendments, setAmendments] = useState<AmendmentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${MEM0_API}/api/v1/ailearn/status`);
      if (!res.ok) throw new Error(`Failed to fetch status: ${res.statusText}`);
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch status");
    }
  }, []);

  // Fetch patterns
  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch(`${MEM0_API}/api/v1/ailearn/patterns?limit=10`);
      if (!res.ok) throw new Error(`Failed to fetch patterns: ${res.statusText}`);
      const data = await res.json();
      setPatterns(data);
    } catch (e) {
      console.error("Failed to fetch patterns:", e);
    }
  }, []);

  // Fetch skills
  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch(`${MEM0_API}/api/v1/ailearn/skills?limit=10`);
      if (!res.ok) throw new Error(`Failed to fetch skills: ${res.statusText}`);
      const data = await res.json();
      setSkills(data);
    } catch (e) {
      console.error("Failed to fetch skills:", e);
    }
  }, []);

  // Fetch amendments
  const fetchAmendments = useCallback(async () => {
    try {
      const res = await fetch(`${MEM0_API}/api/v1/ailearn/amendments?limit=10`);
      if (!res.ok) throw new Error(`Failed to fetch amendments: ${res.statusText}`);
      const data = await res.json();
      setAmendments(data);
    } catch (e) {
      console.error("Failed to fetch amendments:", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchStatus(), fetchPatterns(), fetchSkills(), fetchAmendments()]);
      setLoading(false);
    };
    loadAll();
  }, [fetchStatus, fetchPatterns, fetchSkills, fetchAmendments]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStatus();
      fetchPatterns();
      fetchSkills();
      fetchAmendments();
    }, 10000); // Refresh every 10s

    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus, fetchPatterns, fetchSkills, fetchAmendments]);

  // Start/Stop AI Learning
  const handleToggleAILearn = async () => {
    try {
      if (status?.is_running) {
        await fetch(`${MEM0_API}/api/v1/ailearn/stop`, { method: "POST" });
      } else {
        await fetch(`${MEM0_API}/api/v1/ailearn/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            auto_learn_interval_minutes: 5,
            confidence_threshold: 0.7,
            max_observations_per_batch: 1000,
          }),
        });
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle AI Learning");
    }
  };

  // Trigger manual analysis
  const handleTriggerAnalysis = async () => {
    try {
      await fetch(`${MEM0_API}/api/v1/ailearn/analyze`, { method: "POST" });
      await Promise.all([fetchStatus(), fetchPatterns(), fetchSkills(), fetchAmendments()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger analysis");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-purple-500" />
          <div>
            <h2 className="text-2xl font-bold text-slate-900">AI 自动学习</h2>
            <p className="text-sm text-slate-500">观察记忆操作，自动提取模式和技能</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              id="auto-refresh"
            />
            <label htmlFor="auto-refresh" className="text-sm text-slate-600 cursor-pointer">
              自动刷新
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleAILearn}
            className={status?.is_running ? "text-red-600 hover:text-red-700" : "text-green-600 hover:text-green-700"}
          >
            {status?.is_running ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                停止学习
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                启动学习
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerAnalysis}
            disabled={!status?.is_running}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            立即分析
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatusCard label="观察数据" value={status.observations_count} icon={Brain} />
          <StatusCard label="检测模式" value={status.patterns_detected} icon={Zap} />
          <StatusCard label="提取技能" value={status.skills_extracted} icon={Lightbulb} />
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="rounded-lg bg-slate-50 p-2">
              {getHealthStatusIcon(status.health_status)}
            </div>
            <div>
              <p className="text-sm text-slate-600">系统状态</p>
              <p className="text-lg font-semibold text-slate-900 capitalize">{status.health_status}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="patterns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="patterns">检测模式</TabsTrigger>
          <TabsTrigger value="skills">提取技能</TabsTrigger>
          <TabsTrigger value="amendments">修改提议</TabsTrigger>
        </TabsList>

        <TabsContent value="patterns" className="space-y-4">
          {patterns.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Zap className="h-12 w-12 text-slate-300 mb-4" />
                <p className="text-slate-500">暂无检测到的模式</p>
                <p className="text-sm text-slate-400 mt-1">AI 学习系统正在观察记忆操作...</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {patterns.map((pattern) => (
                <PatternCard key={pattern.id} pattern={pattern} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="skills" className="space-y-4">
          {skills.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Lightbulb className="h-12 w-12 text-slate-300 mb-4" />
                <p className="text-slate-500">暂无提取的技能</p>
                <p className="text-sm text-slate-400 mt-1">技能将从高置信度模式中自动生成...</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="amendments" className="space-y-4">
          {amendments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileEdit className="h-12 w-12 text-slate-300 mb-4" />
                <p className="text-slate-500">暂无修改提议</p>
                <p className="text-sm text-slate-400 mt-1">AI 学习系统会根据模式变化提议修改记忆...</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {amendments.map((amendment) => (
                <AmendmentCard key={amendment.id} amendment={amendment} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
