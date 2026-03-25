"""Cost tracking schemas for token and cost metrics."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from sqlmodel import SQLModel

CostRangeKey = Literal["7d", "14d", "1m", "3m", "6m", "1y"]
CostBucketKey = Literal["day", "week", "month"]


class DailyCostPoint(SQLModel):
    """Single day cost data point."""

    date: str  # YYYY-MM-DD format
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    cache_read_cost_usd: float = 0.0
    cache_write_cost_usd: float = 0.0
    total_cost_usd: float
    conversations_count: int
    messages_count: int
    tool_calls_count: int = 0


class ModelCostBreakdown(SQLModel):
    """Cost breakdown by model."""

    model: str
    provider: str | None = None
    count: int | None = None  # Number of sessions/conversations using this model
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    cache_read_cost_usd: float = 0.0
    cache_write_cost_usd: float = 0.0
    total_cost_usd: float
    conversations_count: int
    messages_count: int


class CostKpis(SQLModel):
    """Topline cost KPI summary values."""

    total_cost_usd: float
    total_tokens: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    conversations_count: int
    messages_count: int
    avg_daily_cost_usd: float
    avg_daily_tokens: int
    top_model_by_cost: str | None = None
    missing_cost_entries: int = 0  # Number of entries without cost data
    tool_calls_count: int = 0
    unique_tools_count: int = 0


class CostMetrics(SQLModel):
    """Complete cost metrics response payload."""

    range: CostRangeKey
    generated_at: datetime
    kpis: CostKpis
    daily_series: list[DailyCostPoint]
    model_breakdown: list[ModelCostBreakdown]
    agent_breakdown: list[AgentCostBreakdown] = []
    agent_daily_series: list[AgentDailyPoint] = []


class AgentCostBreakdown(SQLModel):
    """Cost breakdown by agent."""

    agent_id: str
    agent_name: str | None = None
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    cache_read_cost_usd: float = 0.0
    cache_write_cost_usd: float = 0.0
    total_cost_usd: float
    conversations_count: int
    messages_count: int


class AgentDailyPoint(SQLModel):
    """Single day cost data point by agent."""

    date: str  # YYYY-MM-DD format
    agent_id: str
    agent_name: str | None = None
    input_tokens: int
    output_tokens: int
    total_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    total_cost_usd: float
    conversations_count: int
    messages_count: int
