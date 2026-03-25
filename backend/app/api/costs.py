"""Cost tracking endpoints using OpenClaw Gateway RPC API.

This module provides improved cost tracking by integrating with the OpenClaw Gateway's
WebSocket RPC API (usage.cost method), which provides accurate model-level cost breakdowns.

As a fallback, it also supports the HTTP-based OpenClawClient when Gateway RPC is unavailable.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.deps import require_org_member
from app.core.logging import get_logger
from app.db.session import get_session
from app.models.agents import Agent
from app.models.gateways import Gateway
from app.schemas.costs import (
    AgentCostBreakdown,
    CostBucketKey,
    CostKpis,
    CostMetrics,
    CostRangeKey,
    DailyCostPoint,
    ModelCostBreakdown,
)
from app.services.openclaw.gateway_resolver import gateway_client_config
from app.services.openclaw.gateway_rpc import (
    GatewayConfig,
    OpenClawGatewayError,
    openclaw_call,
)
from app.services.openclaw_client import OpenClawAPIError, OpenClawClient
from app.services.organizations import OrganizationContext

logger = get_logger("app.api.costs")

router = APIRouter(prefix="/costs", tags=["costs"])

# 默认查询范围
RANGE_QUERY = Query(default="7d")
ORG_MEMBER_DEP = Depends(require_org_member)
SESSION_DEP = Depends(get_session)


def _resolve_cost_range(range_key: CostRangeKey) -> tuple[int, str]:
    """解析时间范围，返回 (天数, 桶粒度).

    Args:
        range_key: 时间范围键 (如 "7d", "1m")

    Returns:
        (天数, 桶粒度) 元组
    """
    specs: dict[CostRangeKey, tuple[int, CostBucketKey]] = {
        "7d": (7, "day"),
        "14d": (14, "day"),
        "1m": (30, "day"),
        "3m": (90, "week"),
        "6m": (180, "week"),
        "1y": (365, "month"),
    }
    return specs[range_key]


def _format_model_key(provider: str | None, model: str | None) -> str:
    """格式化模型键为可读的字符串.

    Args:
        provider: 提供商名称 (如 "anthropic")
        model: 模型名称 (如 "claude-sonnet-4-6")

    Returns:
        格式化的模型字符串
    """
    if model:
        if provider and provider != "unknown":
            return f"{provider}/{model}"
        return model
    return "unknown"


async def _fetch_agent_names(
    session: AsyncSession,
    agent_ids: set[str],
) -> dict[str, str]:
    """从数据库批量获取 agent 名称.

    Args:
        session: AsyncSession
        agent_ids: 需要查询的 agent_id 集合 (UUID 字符串)

    Returns:
        agent_id -> agent_name 的映射
    """
    if not agent_ids:
        return {}

    try:
        # 过滤出有效的 UUID 并排除 system
        valid_uuids = {
            agent_id
            for agent_id in agent_ids
            if agent_id != "system" and len(agent_id) == 36  # UUID 长度
        }

        names: dict[str, str] = {}

        # 添加 system 的名称
        if "system" in agent_ids:
            names["system"] = "System"

        if not valid_uuids:
            return names

        # 批量查询
        statement = select(Agent).where(col(Agent.id).in_(valid_uuids))
        results = await session.execute(statement)
        agents = results.scalars().all()

        # 添加查询到的 agent 名称
        names.update({str(agent.id): agent.name for agent in agents})

        return names
    except Exception as e:
        logger.error(f"Failed to fetch agent names: {e}")
        return {}


async def _get_default_gateway_config(
    session: AsyncSession,
    organization_id: str,
) -> GatewayConfig | None:
    """获取组织的默认 gateway 配置.

    Args:
        session: 数据库会话
        organization_id: 组织 ID

    Returns:
        GatewayConfig 如果找到 gateway，否则返回 None
    """
    try:
        # 查询组织的第一个可用 gateway
        statement = Gateway.objects.filter_by(organization_id=organization_id).statement
        results = await session.execute(statement)
        gateway = results.scalars().first()

        if gateway is None:
            logger.warning("No gateway found for organization %s", organization_id)
            return None

        return gateway_client_config(gateway)
    except Exception as e:
        logger.error("Failed to fetch gateway config: %s", e)
        return None


async def _fetch_cost_data_from_gateway(
    config: GatewayConfig,
    days: int,
) -> dict[str, Any] | None:
    """从 Gateway RPC 获取成本数据.

    Args:
        config: Gateway 配置
        days: 查询天数

    Returns:
        Gateway 返回的原始数据，失败时返回 None
    """
    try:
        params = {"days": days, "mode": "utc"}
        data = await openclaw_call("usage.cost", params, config=config)
        return data if isinstance(data, dict) else None
    except OpenClawGatewayError as e:
        logger.warning("Gateway RPC usage.cost failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Unexpected error calling usage.cost: %s", e)
        return None


def _convert_gateway_totals_to_kpis(
    totals: dict[str, Any],
    days_count: int,
    model_breakdown: list[ModelCostBreakdown],
) -> CostKpis:
    """将 Gateway 的 totals 转换为 CostKpis.

    Args:
        totals: Gateway API 返回的 totals 字典
        days_count: 天数
        model_breakdown: 模型成本分解列表

    Returns:
        CostKpis 对象
    """
    total_tokens = totals.get("totalTokens", 0) or 0
    input_tokens = totals.get("input", 0) or 0
    output_tokens = totals.get("output", 0) or 0
    cache_read_tokens = totals.get("cacheRead", 0) or 0
    cache_write_tokens = totals.get("cacheWrite", 0) or 0
    total_cost_usd = totals.get("totalCost", 0.0) or 0.0
    missing_cost_entries = totals.get("missingCostEntries", 0) or 0

    days_count = days_count or 1
    avg_daily_cost_usd = total_cost_usd / days_count
    avg_daily_tokens = total_tokens / days_count

    # 找到成本最高的模型
    top_model_by_cost = None
    if model_breakdown:
        top_model_by_cost = max(model_breakdown, key=lambda x: x.total_cost_usd).model

    return CostKpis(
        total_cost_usd=round(total_cost_usd, 4),
        total_tokens=total_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        conversations_count=0,  # Gateway 不直接提供
        messages_count=0,  # Gateway 不直接提供
        avg_daily_cost_usd=round(avg_daily_cost_usd, 4),
        avg_daily_tokens=int(avg_daily_tokens),
        top_model_by_cost=top_model_by_cost,
        missing_cost_entries=missing_cost_entries,
    )


def _convert_gateway_daily_to_daily_points(
    daily_data: list[dict[str, Any]],
) -> list[DailyCostPoint]:
    """将 Gateway 的 daily 数据转换为 DailyCostPoint 列表.

    Args:
        daily_data: Gateway API 返回的每日数据列表

    Returns:
        DailyCostPoint 列表
    """
    points = []
    for entry in daily_data:
        total_tokens = entry.get("tokens", 0) or 0
        cost = entry.get("cost", 0.0) or 0.0

        # Gateway daily 数据可能只有 tokens 和 cost
        # 使用 input/output breakdown 如果可用
        input_cost = entry.get("inputCost", 0.0) or 0.0
        output_cost = entry.get("outputCost", 0.0) or 0.0

        points.append(
            DailyCostPoint(
                date=entry.get("date", ""),
                input_tokens=entry.get("input", 0) or 0,
                output_tokens=entry.get("output", 0) or 0,
                cache_read_tokens=entry.get("cacheRead", 0) or 0,
                cache_write_tokens=entry.get("cacheWrite", 0) or 0,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost, 4),
                output_cost_usd=round(output_cost, 4),
                cache_read_cost_usd=round(entry.get("cacheReadCost", 0.0) or 0.0, 4),
                cache_write_cost_usd=round(entry.get("cacheWriteCost", 0.0) or 0.0, 4),
                total_cost_usd=round(cost, 4),
                conversations_count=0,
                messages_count=0,
            )
        )

    return points


def _convert_gateway_model_breakdown(
    model_usage: list[dict[str, Any]],
) -> list[ModelCostBreakdown]:
    """将 Gateway 的 byModel 数据转换为 ModelCostBreakdown 列表.

    Args:
        model_usage: Gateway API 返回的 byModel 数据

    Returns:
        ModelCostBreakdown 列表
    """
    breakdowns = []
    for entry in model_usage:
        provider = entry.get("provider")
        model = entry.get("model")
        count = entry.get("count", 0) or 0
        totals = entry.get("totals", {})

        input_tokens = totals.get("input", 0) or 0
        output_tokens = totals.get("output", 0) or 0
        cache_read_tokens = totals.get("cacheRead", 0) or 0
        cache_write_tokens = totals.get("cacheWrite", 0) or 0
        total_tokens = totals.get("totalTokens", 0) or 0
        input_cost_usd = totals.get("inputCost", 0.0) or 0.0
        output_cost_usd = totals.get("outputCost", 0.0) or 0.0
        cache_read_cost_usd = totals.get("cacheReadCost", 0.0) or 0.0
        cache_write_cost_usd = totals.get("cacheWriteCost", 0.0) or 0.0
        total_cost_usd = totals.get("totalCost", 0.0) or 0.0

        breakdowns.append(
            ModelCostBreakdown(
                model=_format_model_key(provider, model),
                provider=provider,
                count=count,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                cache_read_cost_usd=round(cache_read_cost_usd, 4),
                cache_write_cost_usd=round(cache_write_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=0,
                messages_count=0,
            )
        )

    return breakdowns


def _convert_gateway_agent_breakdown(
    by_agent: list[dict[str, Any]],
    agent_names: dict[str, str],
) -> list[AgentCostBreakdown]:
    """将 Gateway 的 byAgent 数据转换为 AgentCostBreakdown 列表.

    Args:
        by_agent: Gateway API 返回的 byAgent 数据
        agent_names: agent_id -> agent_name 映射

    Returns:
        AgentCostBreakdown 列表
    """
    breakdowns = []
    for entry in by_agent:
        agent_id = entry.get("agentId", "")
        totals = entry.get("totals", {})

        input_tokens = totals.get("input", 0) or 0
        output_tokens = totals.get("output", 0) or 0
        cache_read_tokens = totals.get("cacheRead", 0) or 0
        cache_write_tokens = totals.get("cacheWrite", 0) or 0
        total_tokens = totals.get("totalTokens", 0) or 0
        input_cost_usd = totals.get("inputCost", 0.0) or 0.0
        output_cost_usd = totals.get("outputCost", 0.0) or 0.0
        cache_read_cost_usd = totals.get("cacheReadCost", 0.0) or 0.0
        cache_write_cost_usd = totals.get("cacheWriteCost", 0.0) or 0.0
        total_cost_usd = totals.get("totalCost", 0.0) or 0.0

        breakdowns.append(
            AgentCostBreakdown(
                agent_id=agent_id,
                agent_name=agent_names.get(agent_id),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                total_tokens=total_tokens,
                input_cost_usd=round(input_cost_usd, 4),
                output_cost_usd=round(output_cost_usd, 4),
                cache_read_cost_usd=round(cache_read_cost_usd, 4),
                cache_write_cost_usd=round(cache_write_cost_usd, 4),
                total_cost_usd=round(total_cost_usd, 4),
                conversations_count=0,
                messages_count=0,
            )
        )

    return breakdowns


async def _build_cost_metrics_from_gateway_data(
    session: AsyncSession,
    gateway_data: dict[str, Any],
    days: int,
    range_key: CostRangeKey,
) -> CostMetrics:
    """从 Gateway 返回的数据构建 CostMetrics。

    Args:
        session: 数据库会话
        gateway_data: Gateway RPC 返回的原始数据
        days: 查询天数
        range_key: 时间范围键

    Returns:
        CostMetrics 对象
    """
    totals = gateway_data.get("totals", {})
    by_model = gateway_data.get("byModel", [])
    by_agent = gateway_data.get("byAgent", [])
    daily = gateway_data.get("daily", [])

    # 获取 agent IDs 并查询名称
    agent_ids = {
        entry.get("agentId")
        for entry in by_agent
        if entry.get("agentId") and entry.get("agentId") != "unknown"
    }
    agent_names = await _fetch_agent_names(session, agent_ids)

    # 构建响应
    model_breakdown = _convert_gateway_model_breakdown(by_model)
    kpis = _convert_gateway_totals_to_kpis(totals, days, model_breakdown)
    daily_series = _convert_gateway_daily_to_daily_points(daily)

    return CostMetrics(
        range=range_key,
        generated_at=datetime.now(),
        kpis=kpis,
        daily_series=daily_series,
        model_breakdown=model_breakdown,
        agent_breakdown=_convert_gateway_agent_breakdown(by_agent, agent_names),
        agent_daily_series=[],  # 暂不实现
    )


async def _get_cost_metrics_fallback(
    range_key: CostRangeKey,
    session: AsyncSession,
    organization_id: str,
) -> CostMetrics:
    """使用 HTTP 客户端作为 fallback 获取成本数据。

    Args:
        range_key: 时间范围
        session: 数据库会话
        organization_id: 组织 ID

    Returns:
        CostMetrics 对象
    """
    client = OpenClawClient()
    days, _ = _resolve_cost_range(range_key)

    try:
        # 从 OpenClaw HTTP API 获取 sessions.usage 数据
        data = await client.get_sessions_usage(days=days, limit=1000)

        totals = data.get("totals", {})
        aggregates = data.get("aggregates", {})

        # 获取 agent IDs 并查询名称
        by_agent = aggregates.get("byAgent", [])
        agent_ids = {
            entry.get("agentId")
            for entry in by_agent
            if entry.get("agentId") and entry.get("agentId") != "unknown"
        }
        agent_names = await _fetch_agent_names(session, agent_ids)

        # 构建响应
        model_breakdown = _convert_gateway_model_breakdown(
            aggregates.get("byModel", [])
        )
        kpis = _convert_gateway_totals_to_kpis(totals, days, model_breakdown)

        # 构建 daily series - 使用 modelDaily 数据
        model_daily = aggregates.get("modelDaily", [])
        daily_series = []
        if model_daily:
            # 按 date 分组聚合
            daily_map: dict[str, dict[str, Any]] = {}
            for entry in model_daily:
                date = entry.get("date", "")
                if date not in daily_map:
                    daily_map[date] = {"date": date, "tokens": 0, "cost": 0.0}
                daily_map[date]["tokens"] += entry.get("tokens", 0) or 0
                daily_map[date]["cost"] += entry.get("cost", 0.0) or 0.0

            daily_series = [
                DailyCostPoint(
                    date=entry["date"],
                    input_tokens=0,
                    output_tokens=0,
                    total_tokens=entry["tokens"],
                    input_cost_usd=0.0,
                    output_cost_usd=0.0,
                    total_cost_usd=round(entry["cost"], 4),
                    conversations_count=0,
                    messages_count=0,
                )
                for entry in sorted(daily_map.values(), key=lambda x: x["date"])
            ]

        return CostMetrics(
            range=range_key,
            generated_at=datetime.now(),
            kpis=kpis,
            daily_series=daily_series,
            model_breakdown=model_breakdown,
            agent_breakdown=_convert_gateway_agent_breakdown(by_agent, agent_names),
            agent_daily_series=[],  # 暂不实现
        )

    except OpenClawAPIError as e:
        logger.error("OpenClaw HTTP API error: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch cost data from OpenClaw: {str(e)}",
        ) from e
    finally:
        await client.close()


@router.get("/metrics", response_model=CostMetrics)
async def get_cost_metrics(
    range: CostRangeKey = RANGE_QUERY,
    session: AsyncSession = SESSION_DEP,
    ctx: OrganizationContext = ORG_MEMBER_DEP,
) -> CostMetrics:
    """获取成本指标。

    通过 OpenClaw Gateway RPC (usage.cost) 获取准确的模型级别成本数据。
    如果 Gateway RPC 不可用，则降级到 HTTP API。

    Args:
        range: 时间范围 (7d, 14d, 1m, 3m, 6m, 1y)
        session: 数据库会话
        ctx: 组织上下文

    Returns:
        CostMetrics 包含 KPI、每日序列和模型/agent 分解
    """
    days, _ = _resolve_cost_range(range)

    # 1. 首先尝试使用 Gateway RPC
    gateway_config = await _get_default_gateway_config(
        session, str(ctx.organization.id)
    )

    if gateway_config is not None:
        gateway_data = await _fetch_cost_data_from_gateway(gateway_config, days)
        if gateway_data is not None:
            logger.info("Using Gateway RPC for cost data (org=%s)", ctx.organization.id)
            return await _build_cost_metrics_from_gateway_data(
                session, gateway_data, days, range
            )
        else:
            logger.warning(
                "Gateway RPC failed for org=%s, falling back to HTTP API",
                ctx.organization.id,
            )
    else:
        logger.info(
            "No gateway configured for org=%s, using HTTP API", ctx.organization.id
        )

    # 2. Fallback: 使用 HTTP API
    return await _get_cost_metrics_fallback(range, session, str(ctx.organization.id))


@router.get("/models", response_model=list[ModelCostBreakdown])
async def get_model_costs(
    range: CostRangeKey = RANGE_QUERY,
    session: AsyncSession = SESSION_DEP,
    ctx: OrganizationContext = ORG_MEMBER_DEP,
) -> list[ModelCostBreakdown]:
    """获取按模型分组的成本数据。

    Args:
        range: 时间范围
        session: 数据库会话
        ctx: 组织上下文

    Returns:
        模型成本分解列表
    """
    days, _ = _resolve_cost_range(range)

    # 1. 首先尝试使用 Gateway RPC
    gateway_config = await _get_default_gateway_config(
        session, str(ctx.organization.id)
    )

    if gateway_config is not None:
        gateway_data = await _fetch_cost_data_from_gateway(gateway_config, days)
        if gateway_data is not None:
            logger.info(
                "Using Gateway RPC for model costs (org=%s)", ctx.organization.id
            )
            return _convert_gateway_model_breakdown(gateway_data.get("byModel", []))

    # 2. Fallback: 使用 HTTP API
    logger.info(
        "Falling back to HTTP API for model costs (org=%s)", ctx.organization.id
    )
    client = OpenClawClient()

    try:
        data = await client.get_sessions_usage(days=days, limit=1000)
        aggregates = data.get("aggregates", {})

        return _convert_gateway_model_breakdown(aggregates.get("byModel", []))

    except OpenClawAPIError as e:
        logger.error("OpenClaw HTTP API error: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch model costs: {str(e)}",
        ) from e
    finally:
        await client.close()


@router.get("/agents", response_model=list[AgentCostBreakdown])
async def get_agent_costs(
    range: CostRangeKey = RANGE_QUERY,
    session: AsyncSession = SESSION_DEP,
    ctx: OrganizationContext = ORG_MEMBER_DEP,
) -> list[AgentCostBreakdown]:
    """获取按 agent 分组的成本数据。

    Args:
        range: 时间范围
        session: 数据库会话
        ctx: 组织上下文

    Returns:
        Agent 成本分解列表
    """
    days, _ = _resolve_cost_range(range)

    # 1. 首先尝试使用 Gateway RPC
    gateway_config = await _get_default_gateway_config(
        session, str(ctx.organization.id)
    )

    if gateway_config is not None:
        gateway_data = await _fetch_cost_data_from_gateway(gateway_config, days)
        if gateway_data is not None:
            logger.info(
                "Using Gateway RPC for agent costs (org=%s)", ctx.organization.id
            )
            by_agent = gateway_data.get("byAgent", [])

            # 获取 agent 名称
            agent_ids = {
                entry.get("agentId")
                for entry in by_agent
                if entry.get("agentId") and entry.get("agentId") != "unknown"
            }
            agent_names = await _fetch_agent_names(session, agent_ids)

            return _convert_gateway_agent_breakdown(by_agent, agent_names)

    # 2. Fallback: 使用 HTTP API
    logger.info(
        "Falling back to HTTP API for agent costs (org=%s)", ctx.organization.id
    )
    client = OpenClawClient()

    try:
        data = await client.get_sessions_usage(days=days, limit=1000)
        aggregates = data.get("aggregates", {})
        by_agent = aggregates.get("byAgent", [])

        # 获取 agent 名称
        agent_ids = {
            entry.get("agentId")
            for entry in by_agent
            if entry.get("agentId") and entry.get("agentId") != "unknown"
        }
        agent_names = await _fetch_agent_names(session, agent_ids)

        return _convert_gateway_agent_breakdown(by_agent, agent_names)

    except OpenClawAPIError as e:
        logger.error("OpenClaw HTTP API error: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch agent costs: {str(e)}",
        ) from e
    finally:
        await client.close()
