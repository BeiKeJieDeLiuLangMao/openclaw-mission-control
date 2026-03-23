"""Cron job inspection endpoints via Gateway RPC."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select

from app.db.session import get_session
from app.models.agents import Agent
from app.schemas.gateway_api import GatewayResolveQuery
from app.services.openclaw.gateway_rpc import OpenClawGatewayError, openclaw_call
from app.services.openclaw.session_service import GatewaySessionService

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

router = APIRouter(prefix="/crons", tags=["crons"])
SESSION_DEP = Depends(get_session)


def _query_to_resolve_input(
    board_id: str | None = Query(default=None),
    gateway_url: str | None = Query(default=None),
    gateway_token: str | None = Query(default=None),
    gateway_disable_device_pairing: bool | None = Query(default=None),
    gateway_allow_insecure_tls: bool | None = Query(default=None),
) -> GatewayResolveQuery:
    return GatewaySessionService.to_resolve_query(
        board_id=board_id,
        gateway_url=gateway_url,
        gateway_token=gateway_token,
        gateway_disable_device_pairing=gateway_disable_device_pairing,
        gateway_allow_insecure_tls=gateway_allow_insecure_tls,
    )


RESOLVE_INPUT_DEP = Depends(_query_to_resolve_input)


async def _build_agent_map(session: "AsyncSession", board_id: str | None) -> dict[str, str]:
    """Return mapping from cron job agentId -> agent name for agents in board.

    Gateway cron job agentId format: "lead-xxx" or "mc-xxx"
    MC DB openclaw_session_id format: "agent:lead-xxx:main" or "agent:mc-xxx:main"

    We derive agentId from session_id by stripping "agent:" prefix and ":main" suffix.
    """
    if not board_id:
        return {}
    try:
        board_uuid = UUID(board_id)
    except ValueError:
        return {}
    result = await session.exec(
        select(Agent).where(Agent.board_id == board_uuid)
    )
    agents = result.all()
    name_map: dict[str, str] = {}
    for agent in agents:
        sid = agent.openclaw_session_id or ""
        if sid:
            # Full session_id key (for sessionKey matching)
            name_map[sid] = agent.name or sid
            # agentId key: strip "agent:" prefix and ":main" suffix
            # e.g. "agent:lead-xxx:main" -> "lead-xxx"
            # e.g. "agent:mc-{uuid}:main" -> "mc-{uuid}"
            agent_id_key = sid.removeprefix("agent:").removesuffix(":main")
            if agent_id_key:
                name_map[agent_id_key] = agent.name or sid
                # Also map bare UUID (strip "mc-" or "lead-" prefix)
                # e.g. "mc-{uuid}" -> "{uuid}"  |  "lead-{uuid}" -> "{uuid}"
                for prefix in ("mc-", "lead-"):
                    if agent_id_key.startswith(prefix):
                        bare_uuid = agent_id_key[len(prefix):]
                        name_map[bare_uuid] = agent.name or sid
                        break
    return name_map


@router.get("/jobs")
async def list_cron_jobs(
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: "AsyncSession" = SESSION_DEP,
) -> Any:
    """List cron jobs from the Gateway, filtered to MC-managed agents in the board."""
    service = GatewaySessionService(session)
    try:
        _, config, _ = await service.resolve_gateway(
            params,
            user=None,
            organization_id=None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Failed to resolve gateway: {exc}",
        ) from exc

    try:
        result = await openclaw_call("cron.list", config=config)
    except OpenClawGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc}",
        ) from exc

    # Normalize: result may be a list or dict with jobs key
    if isinstance(result, list):
        jobs = result
    elif isinstance(result, dict):
        jobs = result.get("jobs") or result.get("crons") or []
    else:
        jobs = []

    # Build agent name map for this board
    agent_map = await _build_agent_map(session, params.board_id)

    # Filter to only include jobs belonging to MC-managed agents in this board
    # and enrich with agent_name
    filtered_jobs = []
    for job in jobs:
        # Try agentId first (most reliable), then fall back to sessionKey
        job_agent_id = job.get("agentId") or job.get("agent_id") or ""
        session_key = (
            job.get("sessionKey")
            or job.get("session_key")
            or job.get("target_session")
            or job.get("targetSession")
            or ""
        )

        if agent_map:
            # Match by agentId first, then by sessionKey
            agent_name = agent_map.get(job_agent_id) or agent_map.get(session_key)
            if agent_name is None:
                continue  # Skip jobs not belonging to board agents
            job = dict(job)
            job["agent_name"] = agent_name
        else:
            # No board_id provided, show all jobs without filtering
            job = dict(job)
            job["agent_name"] = job_agent_id or session_key or "Unknown"
        filtered_jobs.append(job)

    return {"jobs": filtered_jobs, "total": len(filtered_jobs)}


@router.get("/jobs/{job_id}/runs")
async def list_cron_job_runs(
    job_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: "AsyncSession" = SESSION_DEP,
) -> Any:
    """Get run history for a specific cron job from the Gateway."""
    service = GatewaySessionService(session)
    try:
        _, config, _ = await service.resolve_gateway(
            params,
            user=None,
            organization_id=None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Failed to resolve gateway: {exc}",
        ) from exc

    try:
        result = await openclaw_call(
            "cron.runs",
            {"jobId": job_id, "limit": limit},
            config=config,
        )
    except OpenClawGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc}",
        ) from exc

    # Normalize result
    if isinstance(result, list):
        runs = result
    elif isinstance(result, dict):
        runs = result.get("runs") or result.get("items") or []
    else:
        runs = []

    return {"runs": runs, "total": len(runs)}
