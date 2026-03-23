"""Cost tracking endpoints for token and cost metrics."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import DateTime, func
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.deps import require_org_member
from app.core.config import settings
from app.db.session import get_session
from app.models.agents import Agent
from app.schemas.costs import (
    AgentCostBreakdown,
    AgentDailyPoint,
    CostBucketKey,
    CostKpis,
    CostMetrics,
    CostRangeKey,
    DailyCostPoint,
    ModelCostBreakdown,
)
from app.services.organizations import OrganizationContext

router = APIRouter(prefix="/costs", tags=["costs"])

# LCM 数据库路径
LCM_DB_PATH = Path.home() / ".openclaw" / "lcm.db"

# 模型定价（每百万 token，美元）
MODEL_PRICING = {
    "fai/claude-sonnet-4-6": {"input": 0.8, "output": 2.0},
    "fai/claude-opus-4-6": {"input": 0.8, "output": 2.0},
    # 其他模型使用默认定价
    "default": {"input": 0.8, "output": 2.0},
}

# 默认查询范围
RANGE_QUERY = Query(default="7d")
ORG_MEMBER_DEP = Depends(require_org_member)
SESSION_DEP = Depends(get_session)


def _get_model_pricing(model: str | None) -> dict[str, float]:
    """获取模型定价，如果模型不在列表中则使用默认定价。"""
    if model and model in MODEL_PRICING:
        return MODEL_PRICING[model]
    return MODEL_PRICING["default"]


def _resolve_cost_range(range_key: CostRangeKey) -> tuple[datetime, datetime, CostBucketKey]:
    """解析时间范围，返回 (开始时间, 结束时间, 桶粒度)。"""
    now = datetime.now()
    specs: dict[CostRangeKey, tuple[timedelta, CostBucketKey]] = {
        "7d": (timedelta(days=7), "day"),
        "14d": (timedelta(days=14), "day"),
        "1m": (timedelta(days=30), "day"),
        "3m": (timedelta(days=90), "week"),
        "6m": (timedelta(days=180), "week"),
        "1y": (timedelta(days=365), "month"),
    }
    duration, bucket = specs[range_key]
    return (now - duration, now, bucket)


def _parse_date(date_str: str) -> datetime | None:
    """解析 ISO 格式的日期字符串。"""
    if not date_str:
        return None
    try:
        # 尝试多种 ISO 格式
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
            try:
                return datetime.strptime(date_str.split("+")[0].split("Z")[0].strip(), fmt)
            except ValueError:
                continue
        return None
    except Exception:
        return None


def _format_date(dt: datetime) -> str:
    """格式化日期为 YYYY-MM-DD。"""
    return dt.strftime("%Y-%m-%d")


def _get_lcm_connection() -> sqlite3.Connection:
    """获取 LCM 数据库连接。"""
    if not LCM_DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=f"LCM database not found at {LCM_DB_PATH}",
        )
    try:
        conn = sqlite3.connect(str(LCM_DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to LCM database: {str(e)}",
        )


def _query_daily_costs(
    conn: sqlite3.Connection,
    start_date: datetime,
    end_date: datetime,
) -> list[DailyCostPoint]:
    """查询每日成本数据。

    注意：created_at 存储的是 UTC 时间，需要转换为北京时间 (+8 小时) 来分组。
    """
    # 使用 SQLite 的 date 函数和 datetime 修正时区
    query = """
    SELECT
        date(datetime(created_at, '+8 hours')) as date,
        SUM(CASE WHEN role IN ('user', 'system') THEN token_count ELSE 0 END) as input_tokens,
        SUM(CASE WHEN role = 'assistant' THEN token_count ELSE 0 END) as output_tokens,
        COUNT(DISTINCT conversation_id) as conversations_count,
        COUNT(*) as messages_count
    FROM messages
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY date(datetime(created_at, '+8 hours'))
    ORDER BY date
    """

    start_str = start_date.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_date.strftime("%Y-%m-%d %H:%M:%S")

    cursor = conn.execute(query, (start_str, end_str))
    rows = cursor.fetchall()

    daily_points = []
    for row in rows:
        input_tokens = row["input_tokens"] or 0
        output_tokens = row["output_tokens"] or 0
        total_tokens = input_tokens + output_tokens

        # 计算成本（美元）
        input_cost_usd = (input_tokens / 1_000_000) * MODEL_PRICING["default"]["input"]
        output_cost_usd = (output_tokens / 1_000_000) * MODEL_PRICING["default"]["output"]
        total_cost_usd = input_cost_usd + output_cost_usd

        daily_points.append(
            DailyCostPoint(
                date=row["date"],
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=row["conversations_count"],
                messages_count=row["messages_count"],
            )
        )

    return daily_points


def _query_model_breakdown(
    conn: sqlite3.Connection,
    start_date: datetime,
    end_date: datetime,
) -> list[ModelCostBreakdown]:
    """查询按模型分组的成本数据。

    注意：由于 messages 表没有 model 字段，这里我们返回一个基于 role 的简化版本。
    """
    # 由于 lcm.db 的 messages 表没有存储模型信息，我们按 role 分组作为替代
    query = """
    SELECT
        role as model,
        SUM(token_count) as total_tokens,
        COUNT(DISTINCT conversation_id) as conversations_count,
        COUNT(*) as messages_count
    FROM messages
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY role
    ORDER BY total_tokens DESC
    """

    start_str = start_date.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_date.strftime("%Y-%m-%d %H:%M:%S")

    cursor = conn.execute(query, (start_str, end_str))
    rows = cursor.fetchall()

    breakdowns = []
    for row in rows:
        role = row["model"]
        total_tokens = row["total_tokens"] or 0

        # 根据 role 估算 input/output 比例
        if role == "assistant":
            input_tokens = 0
            output_tokens = total_tokens
            pricing = MODEL_PRICING["default"]
            input_cost_usd = 0
            output_cost_usd = (total_tokens / 1_000_000) * pricing["output"]
        elif role in ("user", "system"):
            input_tokens = total_tokens
            output_tokens = 0
            pricing = MODEL_PRICING["default"]
            input_cost_usd = (total_tokens / 1_000_000) * pricing["input"]
            output_cost_usd = 0
        else:  # tool
            input_tokens = total_tokens
            output_tokens = 0
            pricing = MODEL_PRICING["default"]
            input_cost_usd = (total_tokens / 1_000_000) * pricing["input"]
            output_cost_usd = 0

        total_cost_usd = input_cost_usd + output_cost_usd

        breakdowns.append(
            ModelCostBreakdown(
                model=role,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=row["conversations_count"],
                messages_count=row["messages_count"],
            )
        )

    return breakdowns


def _calculate_kpis(
    daily_points: list[DailyCostPoint],
    model_breakdowns: list[ModelCostBreakdown],
) -> CostKpis:
    """计算 KPI 指标。"""
    total_cost_usd = sum(p.total_cost_usd for p in daily_points)
    total_tokens = sum(p.total_tokens for p in daily_points)
    input_tokens = sum(p.input_tokens for p in daily_points)
    output_tokens = sum(p.output_tokens for p in daily_points)
    conversations_count = sum(p.conversations_count for p in daily_points)
    messages_count = sum(p.messages_count for p in daily_points)

    days_count = len(daily_points) or 1
    avg_daily_cost_usd = total_cost_usd / days_count
    avg_daily_tokens = total_tokens / days_count

    # 找到成本最高的模型
    top_model_by_cost = None
    if model_breakdowns:
        top_model_by_cost = max(model_breakdowns, key=lambda x: x.total_cost_usd).model

    return CostKpis(
        total_cost_usd=round(total_cost_usd, 4),
        total_tokens=total_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        conversations_count=conversations_count,
        messages_count=messages_count,
        avg_daily_cost_usd=round(avg_daily_cost_usd, 4),
        avg_daily_tokens=int(avg_daily_tokens),
        top_model_by_cost=top_model_by_cost,
    )


def _parse_session_key(session_key: str) -> str:
    """从 session_key 解析出 agent_id。

    解析规则:
    - agent:mc-{uuid}:main → uuid (mc agent)
    - agent:mc-{uuid}:ob → uuid (observer session)
    - agent:lead-{boardId}:main → "lead"
    - agent:main:* → "system"
    - 其他 → "unknown"
    """
    if not session_key:
        return "unknown"

    parts = session_key.split(":")
    if len(parts) < 3:
        return "unknown"

    # agent:mc-{uuid}:main 或 agent:mc-{uuid}:ob
    if parts[1].startswith("mc-"):
        return parts[1][3:]  # 去掉 "mc-" 前缀

    # agent:lead-{boardId}:main
    if parts[1].startswith("lead-"):
        return "lead"

    # agent:main:*
    if parts[1] == "main":
        return "system"

    return "unknown"


async def _fetch_agent_names(
    session: AsyncSession,
    agent_ids: set[str],
) -> dict[str, str]:
    """从数据库批量获取 agent 名称。

    Args:
        session: AsyncSession
        agent_ids: 需要查询的 agent_id 集合 (UUID 字符串)

    Returns:
        agent_id -> agent_name 的映射,如果查询失败返回空字典
    """
    if not agent_ids:
        return {}

    try:
        # 过滤出有效的 UUID
        valid_uuids = set()
        for agent_id in agent_ids:
            try:
                UUID(agent_id)
                valid_uuids.add(agent_id)
            except ValueError:
                # 不是有效的 UUID,跳过
                continue

        if not valid_uuids:
            return {}

        # 批量查询
        statement = select(Agent).where(col(Agent.id).in_(valid_uuids))
        results = await session.execute(statement)
        agents = results.scalars().all()

        return {str(agent.id): agent.name for agent in agents}
    except Exception:
        # 查询失败时返回空字典
        return {}


def _query_agent_breakdown(
    conn: sqlite3.Connection,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    """按 agent 聚合 token/成本数据。"""
    query = """
    SELECT
        c.session_key,
        SUM(CASE WHEN m.role IN ('user', 'system') THEN m.token_count ELSE 0 END) as input_tokens,
        SUM(CASE WHEN m.role = 'assistant' THEN m.token_count ELSE 0 END) as output_tokens,
        COUNT(DISTINCT m.conversation_id) as conversations_count,
        COUNT(*) as messages_count
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.conversation_id
    WHERE m.created_at >= ? AND m.created_at <= ?
    GROUP BY c.session_key
    ORDER BY (input_tokens + output_tokens) DESC
    """
    start_str = start_date.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_date.strftime("%Y-%m-%d %H:%M:%S")
    cursor = conn.execute(query, (start_str, end_str))
    return [dict(row) for row in cursor.fetchall()]


def _query_agent_daily(
    conn: sqlite3.Connection,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    """按 agent + 日期聚合 token/成本数据（用于折线图）。"""
    query = """
    SELECT
        date(datetime(m.created_at, '+8 hours')) as date,
        c.session_key,
        SUM(CASE WHEN m.role IN ('user', 'system') THEN m.token_count ELSE 0 END) as input_tokens,
        SUM(CASE WHEN m.role = 'assistant' THEN m.token_count ELSE 0 END) as output_tokens,
        COUNT(DISTINCT m.conversation_id) as conversations_count,
        COUNT(*) as messages_count
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.conversation_id
    WHERE m.created_at >= ? AND m.created_at <= ?
    GROUP BY date(datetime(m.created_at, '+8 hours')), c.session_key
    ORDER BY date, c.session_key
    """
    start_str = start_date.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_date.strftime("%Y-%m-%d %H:%M:%S")
    cursor = conn.execute(query, (start_str, end_str))
    return [dict(row) for row in cursor.fetchall()]


def _aggregate_agent_breakdown(
    raw_data: list[dict],
    agent_names: dict[str, str],
) -> list[AgentCostBreakdown]:
    """聚合 agent 维度的成本数据。

    Args:
        raw_data: _query_agent_breakdown 返回的原始数据
        agent_names: agent_id -> agent_name 的映射

    Returns:
        按 agent_id 聚合后的成本数据列表
    """
    # 按 agent_id 聚合
    agent_stats: dict[str, dict] = {}

    for row in raw_data:
        session_key = row["session_key"]
        agent_id = _parse_session_key(session_key)

        if agent_id not in agent_stats:
            agent_stats[agent_id] = {
                "input_tokens": 0,
                "output_tokens": 0,
                "conversations_count": 0,
                "messages_count": 0,
            }

        agent_stats[agent_id]["input_tokens"] += row["input_tokens"] or 0
        agent_stats[agent_id]["output_tokens"] += row["output_tokens"] or 0
        agent_stats[agent_id]["conversations_count"] += row["conversations_count"]
        agent_stats[agent_id]["messages_count"] += row["messages_count"]

    # 转换为 AgentCostBreakdown 对象
    breakdowns = []
    for agent_id, stats in agent_stats.items():
        input_tokens = stats["input_tokens"]
        output_tokens = stats["output_tokens"]
        total_tokens = input_tokens + output_tokens

        input_cost_usd = (input_tokens / 1_000_000) * MODEL_PRICING["default"]["input"]
        output_cost_usd = (output_tokens / 1_000_000) * MODEL_PRICING["default"]["output"]
        total_cost_usd = input_cost_usd + output_cost_usd

        breakdowns.append(
            AgentCostBreakdown(
                agent_id=agent_id,
                agent_name=agent_names.get(agent_id),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=stats["conversations_count"],
                messages_count=stats["messages_count"],
            )
        )

    # 按总成本降序排序
    breakdowns.sort(key=lambda x: x.total_cost_usd, reverse=True)
    return breakdowns


def _aggregate_agent_daily(
    raw_data: list[dict],
    agent_names: dict[str, str],
) -> list[AgentDailyPoint]:
    """聚合 agent + 日期维度的成本数据。

    Args:
        raw_data: _query_agent_daily 返回的原始数据
        agent_names: agent_id -> agent_name 的映射

    Returns:
        按 agent_id + date 聚合后的成本数据列表
    """
    # 按 agent_id + date 聚合
    agent_daily_stats: dict[str, dict] = {}

    for row in raw_data:
        session_key = row["session_key"]
        agent_id = _parse_session_key(session_key)
        date = row["date"]

        key = f"{agent_id}:{date}"

        if key not in agent_daily_stats:
            agent_daily_stats[key] = {
                "agent_id": agent_id,
                "date": date,
                "input_tokens": 0,
                "output_tokens": 0,
                "conversations_count": 0,
                "messages_count": 0,
            }

        agent_daily_stats[key]["input_tokens"] += row["input_tokens"] or 0
        agent_daily_stats[key]["output_tokens"] += row["output_tokens"] or 0
        agent_daily_stats[key]["conversations_count"] += row["conversations_count"]
        agent_daily_stats[key]["messages_count"] += row["messages_count"]

    # 转换为 AgentDailyPoint 对象
    daily_points = []
    for stats in agent_daily_stats.values():
        input_tokens = stats["input_tokens"]
        output_tokens = stats["output_tokens"]
        total_tokens = input_tokens + output_tokens

        input_cost_usd = (input_tokens / 1_000_000) * MODEL_PRICING["default"]["input"]
        output_cost_usd = (output_tokens / 1_000_000) * MODEL_PRICING["default"]["output"]
        total_cost_usd = input_cost_usd + output_cost_usd

        daily_points.append(
            AgentDailyPoint(
                date=stats["date"],
                agent_id=stats["agent_id"],
                agent_name=agent_names.get(stats["agent_id"]),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=stats["conversations_count"],
                messages_count=stats["messages_count"],
            )
        )

    # 按日期排序
    daily_points.sort(key=lambda x: (x.date, x.agent_id))
    return daily_points


@router.get("/metrics", response_model=CostMetrics)
async def cost_metrics(
    range_key: CostRangeKey = RANGE_QUERY,
    session: AsyncSession = SESSION_DEP,
    ctx: OrganizationContext = ORG_MEMBER_DEP,
) -> CostMetrics:
    """返回成本追踪 KPI 和时间序列数据。

    从 lcm.db 读取 token 使用数据，计算美元成本。
    """
    start_date, end_date, bucket = _resolve_cost_range(range_key)

    conn = _get_lcm_connection()
    try:
        daily_points = _query_daily_costs(conn, start_date, end_date)
        model_breakdowns = _query_model_breakdown(conn, start_date, end_date)

        # 查询 agent 维度数据
        agent_breakdown_raw = _query_agent_breakdown(conn, start_date, end_date)
        agent_daily_raw = _query_agent_daily(conn, start_date, end_date)
    finally:
        conn.close()

    # 收集所有需要查询名称的 agent_id
    agent_ids = set()
    for row in agent_breakdown_raw:
        agent_id = _parse_session_key(row["session_key"])
        if agent_id and agent_id not in ("lead", "system", "unknown"):
            agent_ids.add(agent_id)
    for row in agent_daily_raw:
        agent_id = _parse_session_key(row["session_key"])
        if agent_id and agent_id not in ("lead", "system", "unknown"):
            agent_ids.add(agent_id)

    # 批量获取 agent 名称
    agent_names = await _fetch_agent_names(session, agent_ids)

    # 聚合 agent 维度数据
    agent_breakdowns = _aggregate_agent_breakdown(agent_breakdown_raw, agent_names)
    agent_daily_series = _aggregate_agent_daily(agent_daily_raw, agent_names)

    kpis = _calculate_kpis(daily_points, model_breakdowns)

    return CostMetrics(
        range=range_key,
        generated_at=datetime.now(),
        kpis=kpis,
        daily_series=daily_points,
        model_breakdown=model_breakdowns,
        agent_breakdown=agent_breakdowns,
        agent_daily_series=agent_daily_series,
    )
