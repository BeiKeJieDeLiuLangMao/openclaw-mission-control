"""Agent status detection endpoints based on Gateway sessions."""

from __future__ import annotations

from datetime import datetime, timezone
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


router = APIRouter(prefix="/sessions", tags=["sessions"])
SESSION_DEP = Depends(get_session)

# 30 minutes in milliseconds
ONLINE_THRESHOLD_MS = 30 * 60 * 1000


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


async def _build_agent_map(
    session: "AsyncSession",
    board_id: str | None,
) -> dict[str, Agent]:
    """Return mapping from agent session key to Agent model for agents in board.

    Gateway session key format: "agent:mc-{agent_id}:main" or "agent:lead-{agent_id}:main"
    MC DB openclaw_session_id format: "agent:mc-{uuid}:main" or "agent:lead-{uuid}:main"

    We extract agent_id from session_id by stripping "agent:" prefix and ":main" suffix.
    """
    if not board_id:
        return {}
    try:
        board_uuid = UUID(board_id)
    except ValueError:
        return {}

    result = await session.exec(select(Agent).where(Agent.board_id == board_uuid))
    agents = result.all()
    agent_map: dict[str, Agent] = {}

    for agent in agents:
        sid = agent.openclaw_session_id or ""
        if sid:
            # Full session_id key (for sessionKey matching)
            agent_map[sid] = agent
            # Also map by agent_id (strip "agent:" prefix and ":main" suffix)
            # e.g. "agent:mc-xxx:main" -> "mc-xxx"
            agent_id_key = sid.removeprefix("agent:").removesuffix(":main")
            if agent_id_key:
                agent_map[agent_id_key] = agent

    return agent_map


def _extract_agent_id(session_key: str) -> str | None:
    """Extract agent ID from session key.

    Session key formats:
    - "agent:mc-{agent_id}:main" -> "{agent_id}"
    - "agent:lead-{agent_id}:main" -> "{agent_id}"
    - "agent:{agent_id}:main" -> "{agent_id}"
    """
    if not session_key.startswith("agent:") or not session_key.endswith(":main"):
        return None

    # Skip cron and subagent sessions
    if ":cron:" in session_key or ":subagent:" in session_key:
        return None

    # Remove "agent:" prefix and ":main" suffix
    agent_id = session_key.removeprefix("agent:").removesuffix(":main")
    return agent_id if agent_id else None


def _ms_timestamp_to_iso(ms_timestamp: int | None) -> str | None:
    """Convert millisecond timestamp to ISO 8601 string."""
    if ms_timestamp is None:
        return None
    try:
        dt = datetime.fromtimestamp(ms_timestamp / 1000, tz=timezone.utc)
        return dt.isoformat()
    except (ValueError, OSError):
        return None


def _is_online(updated_at_ms: int | None) -> bool:
    """Check if a session is online based on updated timestamp."""
    if updated_at_ms is None:
        return False
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return (now_ms - updated_at_ms) < ONLINE_THRESHOLD_MS


def _is_working(session: dict[str, Any]) -> bool:
    """Check if an agent is working based on session state."""
    # Working if system has sent messages and tokens are fresh
    system_sent = session.get("systemSent") or session.get("system_sent")
    tokens_fresh = session.get("totalTokensFresh") or session.get("totalTokensFresh")
    return bool(system_sent and tokens_fresh)


@router.get("/agent-status")
async def get_agent_status(
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: "AsyncSession" = SESSION_DEP,
) -> dict[str, Any]:
    """Get agent online status based on Gateway sessions.

    Returns agent statuses for all agents in the board, determined by
    analyzing their Gateway main sessions:
    - working: Agent has an active session with recent activity
    - idle: Agent has an active session but no recent activity
    - offline: Agent has no active session or session is stale

    Status is determined by:
    1. Session updatedAt timestamp (online if within 30 minutes)
    2. Session activity state (working if systemSent=True and totalTokensFresh=True)
    """
    service = GatewaySessionService(session)

    # Resolve gateway configuration
    try:
        board, config, _ = await service.resolve_gateway(
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

    if board is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="board_id is required",
        )

    # Fetch sessions from Gateway
    try:
        sessions_result = await openclaw_call("sessions.list", config=config)
    except OpenClawGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc}",
        ) from exc

    # Normalize sessions response
    if isinstance(sessions_result, dict):
        sessions_list = sessions_result.get("sessions") or []
    elif isinstance(sessions_result, list):
        sessions_list = sessions_result
    else:
        sessions_list = []

    # Build agent map from database
    agent_map = await _build_agent_map(session, params.board_id)

    # Process sessions and determine agent status
    agent_statuses: dict[str, dict[str, Any]] = {}

    # Initialize all known agents as offline
    for agent in agent_map.values():
        if agent.id:
            agent_statuses[str(agent.id)] = {
                "status": "offline",
                "last_active_at": None,
                "session_key": None,
                "aborted_last_run": False,
                "model": None,
                "model_short": None,
            }

    # Update status from sessions
    for sess in sessions_list:
        if not isinstance(sess, dict):
            continue

        session_key = sess.get("key") or sess.get("sessionKey") or ""
        agent_id = _extract_agent_id(session_key)

        if not agent_id:
            continue

        # Find agent by session key or agent_id
        agent = agent_map.get(session_key) or agent_map.get(agent_id)
        if not agent:
            continue

        updated_at_ms = sess.get("updatedAt") or sess.get("updated_at")
        if isinstance(updated_at_ms, str):
            try:
                updated_at_ms = int(updated_at_ms)
            except ValueError:
                updated_at_ms = None

        # Determine status
        if _is_online(updated_at_ms):
            if _is_working(sess):
                status = "working"
            else:
                status = "idle"
        else:
            status = "offline"

        # Derive model display label: prefer "provider/model", fall back to just "model"
        raw_model = sess.get("model") or ""
        raw_provider = sess.get("modelProvider") or ""
        if raw_provider and raw_model:
            model_full = f"{raw_provider}/{raw_model}"
        else:
            model_full = raw_model or raw_provider or None

        agent_statuses[str(agent.id)] = {
            "status": status,
            "last_active_at": _ms_timestamp_to_iso(updated_at_ms),
            "session_key": session_key,
            "aborted_last_run": False,  # Placeholder for future use
            "model": model_full,
            "model_short": raw_model or None,
        }

    return {
        "agent_statuses": agent_statuses,
    }
