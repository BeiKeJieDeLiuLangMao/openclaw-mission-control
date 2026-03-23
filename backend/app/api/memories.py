"""MemOS memory visualization endpoints."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
from sqlmodel import select

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas.memories import (
    AgentMemoryStats,
    AgentWorkspace,
    LCMAgentItem,
    LCMConfig,
    LCMSessionProgress,
    LCMSummaryDetail,
    LCMSummaryItem,
    LCMSummaryListResponse,
    LCMDepthBucket,
    LCMStatsOverview,
    LCMStatsResponse,
    MemoryItem,
    MemoryListResponse,
    MemoryStats,
    RecallLogItem,
    RecallLogResponse,
    TierAgentStats,
    TierListResponse,
    TierStats,
    WorkspaceFileContentResponse,
    WorkspaceFileInfo,
    WorkspaceFilesResponse,
)

if TYPE_CHECKING:
    from collections.abc import Mapping
    from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.session import get_session
from app.models.agents import Agent
from app.models.gateways import Gateway

router = APIRouter(prefix="/memories", tags=["memories"])

# Only show agents managed by Mission Control (mc- prefix = board PM agents, lead- prefix = board lead)
MC_AGENT_FILTER = "AND (c.owner LIKE 'agent:mc-%' OR c.owner LIKE 'agent:lead-%') AND c.owner NOT LIKE 'agent:mc-gateway-%'"

# Default MemOS database path
DEFAULT_MEMOS_DB_PATH = Path.home() / ".openclaw" / "memos-local" / "memos.db"

# LCM database path
LCM_DB_PATH = Path.home() / ".openclaw" / "lcm.db"

async def _fetch_agent_name_map(session: "AsyncSession") -> dict[str, str]:
    """Return a mapping of memory owner id -> human-readable agent name.

    owner format in DB: 'agent:mc-<uuid>' or 'agent:lead-<board-uuid>'
    session_id in agents table: 'agent:mc-<uuid>:main'  (strip ':main' suffix)
    lead agent: session_id may be empty; board_id is embedded in owner key.
    """
    result = await session.exec(select(Agent))
    agents = result.all()

    name_map: dict[str, str] = {}
    for agent in agents:
        session_id: str = agent.openclaw_session_id or ""
        # PM agents: strip ':main' suffix to get owner key
        owner = session_id.removesuffix(":main") if session_id else ""
        if owner:
            name_map[owner] = agent.name
        # Lead agent: owner key is 'agent:lead-<board_id>'
        if agent.is_board_lead and agent.board_id:
            lead_key = f"agent:lead-{agent.board_id}"
            name_map[lead_key] = agent.name

    return name_map


def _get_db_connection() -> sqlite3.Connection:
    """Get a connection to the MemOS SQLite database."""
    db_path = Path(os.environ.get("MEMOS_DB_PATH", str(DEFAULT_MEMOS_DB_PATH)))

    if not Path(db_path).exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MemOS database not found at {db_path}",
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _row_to_memory_stats(row: Mapping[str, any]) -> MemoryStats:
    """Convert a database row to MemoryStats."""
    return MemoryStats(
        total_memories=int(row["total_memories"]),
        memories_with_embeddings=int(row["memories_with_embeddings"]),
        total_agents=int(row["total_agents"]),
    )


def _row_to_agent_memory_stats(row: Mapping[str, any]) -> AgentMemoryStats:
    """Convert a database row to AgentMemoryStats."""
    return AgentMemoryStats(
        agent_id=str(row["agent_id"]),
        memory_count=int(row["memory_count"]),
        embedding_count=int(row["embedding_count"]),
    )


# Keywords for L2 (episodic) and L3 (semantic) tier classification
L2_KEYWORDS = ["踩坑", "报错", "失败", "error", "exception", "修复", "fix", "bug", "issue"]
L3_KEYWORDS = ["规范", "原则", "铁律", "经验", "sop", "规则", "best practice", "方法论", "pattern"]


def _derive_tier(created_at_ts: float, summary: str, content: str) -> tuple[str, str]:
    """
    Derive memory tier based on time-based rules first, then keywords for old memories.

    Priority: time rule > keyword match (recent memories are always L1/L2 regardless of content).
    Returns (tier, reason).
    """
    # Time-based rules take priority
    now = datetime.now().timestamp()
    age_days = (now - created_at_ts) / 86400

    if age_days < 7:
        return ("L1", f"age: {age_days:.1f}d < 7d")
    elif age_days < 30:
        return ("L2", f"age: {age_days:.1f}d in [7d, 30d)")

    # For older memories (>30d), use keyword matching to differentiate L2 vs L3
    combined = f"{summary} {content}".lower()
    for kw in L3_KEYWORDS:
        if kw.lower() in combined:
            return ("L3", f"keyword: {kw}")

    return ("L3", f"age: {age_days:.1f}d >= 30d")


def _row_to_memory_item(row: Mapping[str, any]) -> MemoryItem:
    """Convert a database row to MemoryItem."""
    content = str(row["content"])
    created_at_value = float(row["created_at"])

    # Handle both seconds and milliseconds timestamps
    if created_at_value > 1_000_000_000_000:  # Milliseconds
        created_at_value = created_at_value / 1000

    task_id = None
    if "task_id" in row and row["task_id"] is not None:
        task_id = str(row["task_id"])

    tier, tier_reason = _derive_tier(created_at_value, str(row["summary"]), content)

    return MemoryItem(
        id=str(row["id"]),
        owner=str(row["owner"]),
        summary=str(row["summary"]),
        content_preview=content[:100] if len(content) > 100 else content,
        created_at=datetime.fromtimestamp(created_at_value),
        has_embedding=bool(row["has_embedding"]),
        task_id=task_id,
        tier=tier,
        tier_reason=tier_reason,
    )


def _row_to_recall_log_item(row: Mapping[str, any]) -> RecallLogItem:
    """Convert a database row to RecallLogItem."""
    input_data = {}
    input_data_str = row["input_data"] if "input_data" in row else None
    if input_data_str:
        try:
            input_data = json.loads(str(input_data_str))
        except (json.JSONDecodeError, TypeError):
            input_data = {}

    query = str(input_data.get("query", input_data.get("q", "")) if isinstance(input_data, dict) else "")

    called_at_value = float(row["called_at"])
    # Handle both seconds and milliseconds timestamps
    if called_at_value > 1_000_000_000_000:  # Milliseconds
        called_at_value = called_at_value / 1000

    hit_count = int(row["hit_count"]) if "hit_count" in row else 0

    return RecallLogItem(
        id=int(row["id"]),
        query=query,
        hit_count=hit_count,
        duration_ms=int(row["duration_ms"]),
        called_at=datetime.fromtimestamp(called_at_value),
    )


@router.get("/stats", response_model=MemoryStats)
async def get_memory_stats() -> MemoryStats:
    """Get overall memory statistics across all agents."""
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Get total memories and memories with embeddings
        cursor.execute(
            f"""
            SELECT
                COUNT(*) as total_memories,
                SUM(CASE WHEN e.chunk_id IS NOT NULL THEN 1 ELSE 0 END) as memories_with_embeddings,
                COUNT(DISTINCT c.owner) as total_agents
            FROM chunks c
            LEFT JOIN embeddings e ON c.id = e.chunk_id
            WHERE 1=1 {MC_AGENT_FILTER}
            """
        )
        row = cursor.fetchone()
        if not row:
            return MemoryStats(total_memories=0, memories_with_embeddings=0, total_agents=0)

        return _row_to_memory_stats(row)
    finally:
        conn.close()


@router.get("/by-agent", response_model=list[AgentMemoryStats])
async def get_memory_stats_by_agent(session: "AsyncSession" = Depends(get_session)) -> list[AgentMemoryStats]:
    """Get memory statistics grouped by agent."""
    name_map = await _fetch_agent_name_map(session)

    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        cursor.execute(
            f"""
            SELECT
                c.owner as agent_id,
                COUNT(*) as memory_count,
                COUNT(e.chunk_id) as embedding_count
            FROM chunks c
            LEFT JOIN embeddings e ON c.id = e.chunk_id
            WHERE 1=1 {MC_AGENT_FILTER}
            GROUP BY c.owner
            ORDER BY memory_count DESC
            """
        )

        results = []
        for row in cursor.fetchall():
            agent_id = str(row["agent_id"])
            results.append(AgentMemoryStats(
                agent_id=agent_id,
                memory_count=int(row["memory_count"]),
                embedding_count=int(row["embedding_count"]),
                name=name_map.get(agent_id),
            ))
        return results
    finally:
        conn.close()


@router.get("/list", response_model=MemoryListResponse)
async def list_memories(
    agent_id: str | None = Query(default=None, description="Filter by agent/owner ID"),
    tier: str | None = Query(default=None, description="Filter by tier (L1/L2/L3)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> MemoryListResponse:
    """List memory chunks with pagination and optional agent/tier filter."""
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Build query conditions
        conditions = []
        params = []

        # Tier derivation in SQL mirrors _derive_tier()
        # Priority: keyword match first, then age-based
        # L2 keywords: error/exception/fix/bug related
        # L3 keywords: pattern/rule/sop/best practice related
        # Note: created_at is stored in milliseconds, so we divide by 86400000 to get days
        # Time-based rules take priority; keywords upgrade older memories
        # created_at is in milliseconds; compare with Unix epoch seconds * 1000
        TIER_CASE = f"""CASE
            WHEN c.created_at > (strftime('%s','now') - 7*86400) * 1000 THEN 'L1'
            WHEN c.created_at > (strftime('%s','now') - 30*86400) * 1000 THEN 'L2'
            WHEN LOWER(c.summary || ' ' || c.content) GLOB '*规范*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*原则*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*铁律*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*经验*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*sop*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*规则*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*best practice*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*方法论*'
              OR LOWER(c.summary || ' ' || c.content) GLOB '*pattern*'
              THEN 'L3'
            ELSE 'L3'
        END"""

        # Always restrict to MC-managed agents (exclude gateway system agent)
        conditions.append("(c.owner LIKE 'agent:mc-%' OR c.owner LIKE 'agent:lead-%') AND c.owner NOT LIKE 'agent:mc-gateway-%'")

        if agent_id:
            conditions.append("c.owner = ?")
            params.append(agent_id)

        if tier:
            conditions.append(f"({TIER_CASE}) = ?")
            params.append(tier)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        # Get total count
        count_query = f"""
            SELECT COUNT(*) as total
            FROM chunks c
            {where_clause}
        """
        cursor.execute(count_query, params)
        total_row = cursor.fetchone()
        total = int(total_row["total"]) if total_row else 0

        # Get paginated results
        list_query = f"""
            SELECT
                c.id,
                c.owner,
                c.summary,
                c.content,
                c.created_at,
                c.task_id,
                CASE WHEN e.chunk_id IS NOT NULL THEN 1 ELSE 0 END as has_embedding,
                {TIER_CASE} as derived_tier
            FROM chunks c
            LEFT JOIN embeddings e ON c.id = e.chunk_id
            {where_clause}
            ORDER BY c.created_at DESC
            LIMIT ?
            OFFSET ?
        """
        cursor.execute(list_query, params + [limit, offset])
        rows = cursor.fetchall()

        items = [_row_to_memory_item(row) for row in rows]

        return MemoryListResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
        )
    finally:
        conn.close()


@router.get("/recall-log", response_model=RecallLogResponse)
async def get_recall_log(
    limit: int = Query(default=50, ge=1, le=200),
) -> RecallLogResponse:
    """Get recent memory recall (search) logs."""
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Get total count of memory_search calls
        cursor.execute(
            """
            SELECT COUNT(*) as total
            FROM api_logs
            WHERE tool_name = 'memory_search'
            """
        )
        total_row = cursor.fetchone()
        total = int(total_row["total"]) if total_row else 0

        # Get recent memory_search logs with hit count
        # Note: hit_count is derived from output_data which contains the results
        cursor.execute(
            """
            SELECT
                id,
                tool_name,
                input_data,
                output_data,
                duration_ms,
                called_at
            FROM api_logs
            WHERE tool_name = 'memory_search'
            ORDER BY called_at DESC
            LIMIT ?
            """,
            [limit],
        )
        rows = cursor.fetchall()

        items = []
        for row in rows:
            try:
                output_data_str = row["output_data"] if "output_data" in row else ""
                output_data = json.loads(output_data_str) if output_data_str else {}

                # hit_count is the number of results returned
                hit_count = 0
                if isinstance(output_data, dict):
                    results = output_data.get("candidates", output_data.get("results", output_data.get("matches", [])))
                    hit_count = len(results) if isinstance(results, list) else 0
                elif isinstance(output_data, list):
                    hit_count = len(output_data)

                # Create a modified row dict with hit_count
                row_dict = {key: row[key] for key in row.keys()}
                row_dict["hit_count"] = hit_count

                items.append(_row_to_recall_log_item(row_dict))
            except (json.JSONDecodeError, TypeError):
                # Skip malformed entries
                continue

        return RecallLogResponse(
            items=items,
            total=total,
            limit=limit,
        )
    finally:
        conn.close()


@router.get("/by-tier", response_model=TierListResponse)
async def get_memory_stats_by_tier() -> TierListResponse:
    """Get memory statistics grouped by tier (L1/L2/L3)."""
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Fetch all records with created_at for tier computation
        cursor.execute(
            """
            SELECT id, owner, summary, content, created_at
            FROM chunks
            ORDER BY created_at DESC
            """
        )
        rows = cursor.fetchall()

        # Aggregate by tier
        tier_map: dict[str, dict[str, int]] = {"L1": {}, "L2": {}, "L3": {}}

        for row in rows:
            created_at_value = float(row["created_at"])
            if created_at_value > 1_000_000_000_000:
                created_at_value /= 1000

            tier, _ = _derive_tier(created_at_value, str(row["summary"]), str(row["content"]))
            owner = str(row["owner"])
            if owner not in tier_map[tier]:
                tier_map[tier][owner] = 0
            tier_map[tier][owner] += 1

        tier_order = ["L1", "L2", "L3"]
        tiers = []
        for t in tier_order:
            agents = [
                TierAgentStats(agent_id=aid, memory_count=cnt)
                for aid, cnt in sorted(tier_map[t].items(), key=lambda x: -x[1])
            ]
            total = sum(x.memory_count for x in agents)
            tiers.append(TierStats(tier=t, memory_count=total, agents=agents))

        return TierListResponse(tiers=tiers)
    finally:
        conn.close()


def _extract_agent_id_from_workspace_dir(name: str) -> str | None:
    """Extract agent ID from workspace directory name.

    Directory names: workspace-mc-<uuid>, workspace-lead-<board-uuid>, workspace-gateway-<uuid>
    """
    if name.startswith("workspace-mc-"):
        return name[len("workspace-mc-"):]
    if name.startswith("workspace-lead-"):
        return name[len("workspace-lead-"):]
    if name.startswith("workspace-gateway-"):
        return name[len("workspace-gateway-"):]
    return None


def _list_workspace_memory_files(workspace_root: Path) -> list[WorkspaceFileInfo]:
    """List memory/*.md and MEMORY.md files in a workspace."""
    files: list[WorkspaceFileInfo] = []
    memory_dir = workspace_root / "memory"

    # Collect .md files: memory/*.md and workspace-root/MEMORY.md
    targets: list[Path] = []
    if memory_dir.is_dir():
        targets.extend(memory_dir.glob("*.md"))
    root_md = workspace_root / "MEMORY.md"
    if root_md.is_file():
        targets.append(root_md)

    for path in sorted(targets):
        try:
            stat = path.stat()
            # Compute relative path from workspace root
            if path.parent == workspace_root:
                rel_path = path.name
            else:
                rel_path = str(path.relative_to(workspace_root)).replace("\\", "/")
            files.append(WorkspaceFileInfo(
                name=path.name,
                path=rel_path,
                size=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime),
            ))
        except OSError:
            continue

    return files


@router.get("/workspace-files", response_model=WorkspaceFilesResponse)
async def list_workspace_files(
    session: "AsyncSession" = Depends(get_session),
) -> WorkspaceFilesResponse:
    """List memory files across all agent workspaces.

    Scans ~/.openclaw/workspace-*/ directories, resolves agent names,
    and returns memory/*.md and MEMORY.md files per workspace.
    """
    openclaw_dir = Path.home() / ".openclaw"
    if not openclaw_dir.exists():
        return WorkspaceFilesResponse(workspaces=[])

    # Build lookup maps with string keys (since workspace dirs contain string UUIDs)
    agents_result = await session.exec(select(Agent))
    agents = agents_result.all()

    agent_name_map: dict[str, str] = {str(a.id): a.name for a in agents}
    lead_name_map: dict[str, str] = {str(a.board_id): a.name for a in agents if a.is_board_lead and a.board_id}

    # Fetch gateway names
    gateway_result = await session.exec(select(Gateway))
    gateways = gateway_result.all()
    gateway_name_map: dict[str, str] = {str(g.id): g.name for g in gateways}

    workspaces: list[AgentWorkspace] = []
    for ws_dir in sorted(openclaw_dir.iterdir()):
        if not ws_dir.is_dir() or not ws_dir.name.startswith("workspace-"):
            continue

        agent_id = _extract_agent_id_from_workspace_dir(ws_dir.name)
        if not agent_id:
            continue

        # Determine agent name based on workspace type
        agent_name = None
        if ws_dir.name.startswith("workspace-mc-"):
            agent_name = agent_name_map.get(agent_id)
        elif ws_dir.name.startswith("workspace-lead-"):
            agent_name = lead_name_map.get(agent_id)
        elif ws_dir.name.startswith("workspace-gateway-"):
            agent_name = gateway_name_map.get(agent_id)

        files = _list_workspace_memory_files(ws_dir)
        workspaces.append(AgentWorkspace(
            agent_id=agent_id,
            agent_name=agent_name,
            files=files,
        ))

    return WorkspaceFilesResponse(workspaces=workspaces)


_OPENCLAW_WORKSPACE_PREFIX = str(Path.home() / ".openclaw" / "workspace-")


@router.get("/workspace-file", response_model=WorkspaceFileContentResponse)
async def get_workspace_file_content(
    path: str = Query(..., description="Absolute or relative path to the file"),
) -> WorkspaceFileContentResponse:
    """Read the content of a workspace memory file.

    Security: only files under ~/.openclaw/workspace-* are accessible.
    """
    if not path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="path is required")

    # Resolve to absolute path
    if path.startswith("/"):
        file_path = Path(path).resolve()
    else:
        file_path = (Path.home() / path).resolve()

    resolved_str = str(file_path)
    if not resolved_str.startswith(_OPENCLAW_WORKSPACE_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: file must be under ~/.openclaw/workspace-*",
        )

    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    try:
        content = file_path.read_text(encoding="utf-8")
    except OSError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {e!s}",
        )

    return WorkspaceFileContentResponse(
        content=content,
        path=resolved_str,
    )


def _get_lcm_connection() -> sqlite3.Connection:
    """Get a connection to the LCM SQLite database."""
    if not LCM_DB_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"LCM database not found at {LCM_DB_PATH}",
        )

    conn = sqlite3.connect(str(LCM_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@router.get("/lcm-agents", response_model=list[LCMAgentItem])
async def list_lcm_agents(
    session: "AsyncSession" = Depends(get_session),
) -> list[LCMAgentItem]:
    """Return all agents that have LCM records, with name and count."""
    if not LCM_DB_PATH.exists():
        return []

    # Build agent name map from PostgreSQL
    agents_result = await session.exec(select(Agent))
    agents = agents_result.all()
    name_map: dict[str, str] = {}
    for agent in agents:
        sid: str = agent.openclaw_session_id or ""
        owner = sid.removesuffix(":main") if sid else ""
        if owner:
            name_map[owner] = agent.name
        if agent.is_board_lead and agent.board_id:
            name_map[f"agent:lead-{agent.board_id}"] = agent.name

    conn = _get_lcm_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT c.session_key
            FROM conversations c
            WHERE c.session_key LIKE 'agent:mc-%' OR c.session_key LIKE 'agent:lead-%'
            ORDER BY c.session_key
        """)
        rows = cursor.fetchall()

        results: list[LCMAgentItem] = []
        for row in rows:
            session_key = str(row["session_key"])
            # Count summaries per session
            cursor.execute(
                "SELECT COUNT(*) as cnt FROM summaries s JOIN conversations c ON s.conversation_id = c.conversation_id WHERE c.session_key = ?",
                [session_key],
            )
            count_row = cursor.fetchone()
            count = int(count_row["cnt"]) if count_row else 0
            results.append(LCMAgentItem(
                session_key=session_key,
                agent_name=name_map.get(session_key) or name_map.get(session_key.removesuffix(":main")),
                count=count,
            ))

        # Only return board members (agents with known names), sort by count descending
        results = [r for r in results if r.agent_name is not None]
        results.sort(key=lambda x: -x.count)
        return results
    finally:
        conn.close()


@router.get("/lcm-summaries", response_model=LCMSummaryListResponse)
async def list_lcm_summaries(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    kind: str = Query(default="all", description="Filter by kind (all/leaf/condensed)"),
    session_key: str | None = Query(default=None, description="Filter by exact session key"),
    agent_id: str | None = Query(default=None, description="Filter by session_key containing agent_id"),
    db_session: "AsyncSession" = Depends(get_session),
) -> LCMSummaryListResponse:
    """List LCM (lossless-claw) summaries with pagination and optional filters.
    Only returns summaries from board team members (agents with known names).
    """
    if not LCM_DB_PATH.exists():
        return LCMSummaryListResponse(items=[], total=0, limit=limit, offset=offset)

    # Build agent name map from PostgreSQL (board members only)
    agents_result = await db_session.exec(select(Agent))
    agents = agents_result.all()
    name_map: dict[str, str] = {}
    for agent in agents:
        sid: str = agent.openclaw_session_id or ""
        if sid:
            name_map[sid] = agent.name
            name_map[sid.removesuffix(":main")] = agent.name
        if agent.is_board_lead and agent.board_id:
            name_map[f"agent:lead-{agent.board_id}:main"] = agent.name
            name_map[f"agent:lead-{agent.board_id}"] = agent.name

    # Only include session_keys from known board members
    known_session_keys = [k for k in name_map if k.endswith(":main")]

    conn = _get_lcm_connection()
    try:
        cursor = conn.cursor()

        # Build query conditions
        conditions = []
        params: list = []

        if kind != "all":
            conditions.append("s.kind = ?")
            params.append(kind)

        if session_key:
            conditions.append("c.session_key = ?")
            params.append(session_key)
        elif agent_id:
            conditions.append("c.session_key LIKE ?")
            params.append(f"%{agent_id}%")
        else:
            # Only show board members
            if known_session_keys:
                placeholders = ",".join("?" * len(known_session_keys))
                conditions.append(f"c.session_key IN ({placeholders})")
                params.extend(known_session_keys)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        # Get total count
        count_query = f"""
            SELECT COUNT(*) as total
            FROM summaries s
            JOIN conversations c ON s.conversation_id = c.conversation_id
            {where_clause}
        """
        cursor.execute(count_query, params)
        total_row = cursor.fetchone()
        total = int(total_row["total"]) if total_row else 0

        # Get paginated results
        list_query = f"""
            SELECT
                s.summary_id,
                c.session_key,
                s.kind,
                s.depth,
                s.token_count,
                s.earliest_at,
                s.latest_at,
                s.descendant_count,
                s.content
            FROM summaries s
            JOIN conversations c ON s.conversation_id = c.conversation_id
            {where_clause}
            ORDER BY s.created_at DESC
            LIMIT ?
            OFFSET ?
        """
        cursor.execute(list_query, params + [limit, offset])
        rows = cursor.fetchall()

        items = []
        for row in rows:
            content = str(row["content"]) if row["content"] else ""
            try:
                earliest_at = datetime.fromisoformat(row["earliest_at"]) if row["earliest_at"] else None
            except (ValueError, TypeError):
                earliest_at = None
            try:
                latest_at = datetime.fromisoformat(row["latest_at"]) if row["latest_at"] else None
            except (ValueError, TypeError):
                latest_at = None

            sk = str(row["session_key"])
            items.append(LCMSummaryItem(
                summary_id=str(row["summary_id"]),
                session_key=sk,
                agent_name=name_map.get(sk) or name_map.get(sk.removesuffix(":main")),
                kind=str(row["kind"]),
                depth=int(row["depth"]),
                token_count=int(row["token_count"]),
                earliest_at=earliest_at,
                latest_at=latest_at,
                descendant_count=int(row["descendant_count"]),
                content_preview=content[:150] if len(content) > 150 else content,
            ))

        return LCMSummaryListResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
        )
    finally:
        conn.close()


@router.get("/lcm-summary/{summary_id}")
async def get_lcm_summary(summary_id: str) -> LCMSummaryDetail:
    """Get detailed LCM summary with full content and relationships."""
    if not LCM_DB_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"LCM database not found at {LCM_DB_PATH}",
        )

    conn = _get_lcm_connection()
    try:
        cursor = conn.cursor()

        # Get summary details
        cursor.execute("""
            SELECT s.*, c.session_key
            FROM summaries s
            JOIN conversations c ON s.conversation_id = c.conversation_id
            WHERE s.summary_id = ?
        """, [summary_id])
        row = cursor.fetchone()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Summary {summary_id} not found",
            )

        # Get parent summaries
        cursor.execute(
            "SELECT parent_summary_id FROM summary_parents WHERE summary_id = ?",
            [summary_id]
        )
        parent_rows = cursor.fetchall()
        parent_ids = [str(r["parent_summary_id"]) for r in parent_rows]

        # Get child summaries
        cursor.execute(
            "SELECT summary_id FROM summary_parents WHERE parent_summary_id = ?",
            [summary_id]
        )
        child_rows = cursor.fetchall()
        child_ids = [str(r["summary_id"]) for r in child_rows]

        try:
            earliest_at = datetime.fromisoformat(row["earliest_at"]) if row["earliest_at"] else None
        except (ValueError, TypeError):
            earliest_at = None
        try:
            latest_at = datetime.fromisoformat(row["latest_at"]) if row["latest_at"] else None
        except (ValueError, TypeError):
            latest_at = None

        return LCMSummaryDetail(
            summary_id=str(row["summary_id"]),
            session_key=str(row["session_key"]),
            kind=str(row["kind"]),
            depth=int(row["depth"]),
            token_count=int(row["token_count"]),
            earliest_at=earliest_at,
            latest_at=latest_at,
            descendant_count=int(row["descendant_count"]),
            content=str(row["content"]) if row["content"] else "",
            parent_ids=parent_ids,
            child_ids=child_ids,
        )
    finally:
        conn.close()


@router.get("/lcm-stats", response_model=LCMStatsResponse)
async def get_lcm_stats(
    db_session: "AsyncSession" = Depends(get_session),
) -> LCMStatsResponse:
    """Return LCM compression statistics across all board-member sessions.

    Overview counts and per-session breakdown sourced from the LCM SQLite DB;
    agent names resolved from the PostgreSQL agents table.
    """
    # Read lossless-claw config from openclaw.json
    _OPENCLAW_JSON = Path.home() / ".openclaw" / "openclaw.json"
    _DEFAULT_FRESH_TAIL = 32
    _DEFAULT_LEAF_CHUNK_TOKENS = 20_000
    lcm_config: LCMConfig | None = None
    fresh_tail_count = _DEFAULT_FRESH_TAIL
    leaf_chunk_tokens = _DEFAULT_LEAF_CHUNK_TOKENS
    try:
        if _OPENCLAW_JSON.exists():
            with open(_OPENCLAW_JSON) as _f:
                _oc = json.load(_f)
            _lc_conf = (
                _oc.get("plugins", {})
                   .get("entries", {})
                   .get("lossless-claw", {})
                   .get("config", {})
            )
            fresh_tail_count = int(_lc_conf.get("freshTailCount", _DEFAULT_FRESH_TAIL))
            leaf_chunk_tokens = int(_lc_conf.get("leafChunkTokens", _DEFAULT_LEAF_CHUNK_TOKENS))
            lcm_config = LCMConfig(
                fresh_tail_count=fresh_tail_count,
                leaf_chunk_tokens=leaf_chunk_tokens,
            )
    except Exception:
        pass

    if not LCM_DB_PATH.exists():
        return LCMStatsResponse(
            overview=LCMStatsOverview(
                conversations=0,
                messages=0,
                summaries_leaf=0,
                summaries_condensed=0,
            ),
            sessions=[],
            depth_distribution=[],
            config=lcm_config,
        )

    # Build agent name map from PostgreSQL (same logic as list_lcm_summaries)
    agents_result = await db_session.exec(select(Agent))
    agents = agents_result.all()
    name_map: dict[str, str] = {}
    for agent in agents:
        sid: str = agent.openclaw_session_id or ""
        if sid:
            name_map[sid] = agent.name
            name_map[sid.removesuffix(":main")] = agent.name
        if agent.is_board_lead and agent.board_id:
            name_map[f"agent:lead-{agent.board_id}:main"] = agent.name
            name_map[f"agent:lead-{agent.board_id}"] = agent.name

    # Only include session_keys from known board members
    known_session_keys = {k for k in name_map if k.endswith(":main")}

    conn = _get_lcm_connection()
    try:
        cursor = conn.cursor()

        # ── Overview counts ────────────────────────────────────────────────
        # conversations: distinct session_keys for board members
        placeholders = ",".join("?" * len(known_session_keys)) if known_session_keys else "NULL"
        cursor.execute(
            f"SELECT COUNT(DISTINCT session_key) as cnt FROM conversations WHERE session_key IN ({placeholders})",
            list(known_session_keys) if known_session_keys else [],
        )
        row = cursor.fetchone()
        conversations = int(row["cnt"]) if row and row["cnt"] else 0

        # messages: count for board member sessions (messages table has no session_key, must join)
        cursor.execute(
            f"""
            SELECT COUNT(m.message_id) as cnt
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            WHERE c.session_key IN ({placeholders})
            """,
            list(known_session_keys) if known_session_keys else [],
        )
        messages_row = cursor.fetchone()
        messages = int(messages_row["cnt"]) if messages_row and messages_row["cnt"] else 0

        # summaries_leaf
        cursor.execute(
            f"""
            SELECT COUNT(*) as cnt FROM summaries s
            JOIN conversations c ON s.conversation_id = c.conversation_id
            WHERE c.session_key IN ({placeholders}) AND s.kind = 'leaf'
            """,
            list(known_session_keys) if known_session_keys else [],
        )
        leaf_row = cursor.fetchone()
        summaries_leaf = int(leaf_row["cnt"]) if leaf_row["cnt"] else 0

        # summaries_condensed
        cursor.execute(
            f"""
            SELECT COUNT(*) as cnt FROM summaries s
            JOIN conversations c ON s.conversation_id = c.conversation_id
            WHERE c.session_key IN ({placeholders}) AND s.kind = 'condensed'
            """,
            list(known_session_keys) if known_session_keys else [],
        )
        cond_row = cursor.fetchone()
        summaries_condensed = int(cond_row["cnt"]) if cond_row["cnt"] else 0

        overview = LCMStatsOverview(
            conversations=conversations,
            messages=messages,
            summaries_leaf=summaries_leaf,
            summaries_condensed=summaries_condensed,
        )

        # ── Per-session progress ───────────────────────────────────────────
        if known_session_keys:
            # message count + token sum per session (messages table has no session_key, must join)
            cursor.execute(
                f"""
                SELECT
                    c.session_key,
                    COUNT(m.message_id) as message_count,
                    COALESCE(SUM(m.token_count), 0) as token_count
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.conversation_id
                WHERE c.session_key IN ({placeholders})
                GROUP BY c.session_key
                ORDER BY message_count DESC
                """,
                list(known_session_keys),
            )
            msg_rows = cursor.fetchall()
            msg_map: dict[str, dict[str, int]] = {}
            for r in msg_rows:
                msg_map[str(r["session_key"])] = {
                    "message_count": int(r["message_count"]),
                    "token_count": int(r["token_count"]),
                }

            # leaf + condensed counts per session
            cursor.execute(
                f"""
                SELECT c.session_key, s.kind, COUNT(*) as cnt
                FROM summaries s
                JOIN conversations c ON s.conversation_id = c.conversation_id
                WHERE c.session_key IN ({placeholders})
                GROUP BY c.session_key, s.kind
                """,
                list(known_session_keys),
            )
            summary_rows = cursor.fetchall()
            summary_map: dict[str, dict[str, int]] = {}
            for r in summary_rows:
                sk = str(r["session_key"])
                if sk not in summary_map:
                    summary_map[sk] = {"leaf": 0, "condensed": 0}
                summary_map[sk][str(r["kind"])] = int(r["cnt"])

            # last_updated: max of messages.created_at per session (created_at is ISO text)
            cursor.execute(
                f"""
                SELECT c.session_key, MAX(m.created_at) as last_updated
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.conversation_id
                WHERE c.session_key IN ({placeholders})
                GROUP BY c.session_key
                """,
                list(known_session_keys),
            )
            last_rows = cursor.fetchall()
            last_map: dict[str, str | None] = {}
            for r in last_rows:
                ts = r["last_updated"]
                last_map[str(r["session_key"])] = str(ts) if ts else None

            # processed_messages: count messages covered by leaf summaries via summary_messages
            cursor.execute(
                f"""
                SELECT c.session_key, COUNT(DISTINCT sm.message_id) as processed_messages
                FROM summaries s
                JOIN conversations c ON s.conversation_id = c.conversation_id
                JOIN summary_messages sm ON sm.summary_id = s.summary_id
                WHERE c.session_key IN ({placeholders}) AND s.kind = 'leaf'
                GROUP BY c.session_key
                """,
                list(known_session_keys),
            )
            processed_rows = cursor.fetchall()
            processed_map: dict[str, int] = {}
            for r in processed_rows:
                processed_map[str(r["session_key"])] = int(r["processed_messages"])

            # raw_tokens_outside_tail: sum of token_count for messages outside freshTail
            # that are NOT yet covered by any leaf summary.
            # "outside tail" = seq <= (total_messages - freshTailCount)
            # "not covered"  = message_id NOT IN summary_messages for leaf summaries
            raw_tokens_map: dict[str, int] = {}
            for sk in known_session_keys:
                total_msgs = msg_map.get(sk, {}).get("message_count", 0)
                tail_cutoff_seq = max(0, total_msgs - fresh_tail_count)
                if tail_cutoff_seq == 0:
                    raw_tokens_map[sk] = 0
                    continue
                cursor.execute(
                    """
                    SELECT COALESCE(SUM(m.token_count), 0) as raw_tokens
                    FROM messages m
                    JOIN conversations c ON m.conversation_id = c.conversation_id
                    WHERE c.session_key = ?
                      AND m.seq <= ?
                      AND m.message_id NOT IN (
                          SELECT sm.message_id
                          FROM summary_messages sm
                          JOIN summaries s ON s.summary_id = sm.summary_id
                          JOIN conversations c2 ON c2.conversation_id = s.conversation_id
                          WHERE c2.session_key = ? AND s.kind = 'leaf'
                      )
                    """,
                    (sk, tail_cutoff_seq, sk),
                )
                row = cursor.fetchone()
                raw_tokens_map[sk] = int(row["raw_tokens"]) if row and row["raw_tokens"] else 0

            # Build session list, sorted by message_count desc
            sessions: list[LCMSessionProgress] = []
            for sk, name in name_map.items():
                if not sk.endswith(":main"):
                    continue
                m = msg_map.get(sk, {"message_count": 0, "token_count": 0})
                sm = summary_map.get(sk, {"leaf": 0, "condensed": 0})
                sessions.append(LCMSessionProgress(
                    session_key=sk,
                    agent_name=name,
                    message_count=m["message_count"],
                    token_count=m["token_count"],
                    leaf_count=sm["leaf"],
                    condensed_count=sm["condensed"],
                    processed_messages=processed_map.get(sk, 0),
                    last_updated=last_map.get(sk),
                    raw_tokens_outside_tail=raw_tokens_map.get(sk, 0),
                ))
            sessions.sort(key=lambda x: -x.message_count)
        else:
            sessions = []

        # ── Depth distribution ──────────────────────────────────────────────
        depth_map: dict[tuple[str, int], int] = {}
        if known_session_keys:
            cursor.execute(
                f"""
                SELECT s.kind, s.depth, COUNT(*) as cnt
                FROM summaries s
                JOIN conversations c ON s.conversation_id = c.conversation_id
                WHERE c.session_key IN ({placeholders})
                GROUP BY s.kind, s.depth
                ORDER BY s.kind, s.depth
                """,
                list(known_session_keys),
            )
            for r in cursor.fetchall():
                key = (str(r["kind"]), int(r["depth"]))
                depth_map[key] = int(r["cnt"])

        depth_distribution = [
            LCMDepthBucket(kind=kind, depth=depth, count=cnt)
            for (kind, depth), cnt in sorted(depth_map.items())
        ]

        return LCMStatsResponse(
            overview=overview,
            sessions=sessions,
            depth_distribution=depth_distribution,
            config=lcm_config,
        )
    finally:
        conn.close()


@router.get("/memos-dashboard")
async def get_memos_dashboard() -> dict:
    """Return complete MemOS statistics dashboard.

    Aggregates tier distribution, importance histogram, supersession,
    memory graph stats, conflict detection, heat distribution, guardian status,
    and observer sessions from LCM.
    """
    import time

    now_ts = int(time.time())
    seven_days_ago = now_ts - 7 * 86400
    thirty_days_ago = now_ts - 30 * 86400

    # ── MemOS data ─────────────────────────────────────────────────────────────
    conn = _get_db_connection()
    try:
        cursor = conn.cursor()

        # Tier distribution (use actual tier column from schema)
        cursor.execute("""
            SELECT
                COALESCE(tier, 'unclassified') as t,
                COUNT(*) as cnt
            FROM chunks
            GROUP BY t
        """)
        tier_raw = {row["t"]: int(row["cnt"]) for row in cursor.fetchall()}
        tier_distribution = {
            "L1": tier_raw.get("L1", 0),
            "L2": tier_raw.get("L2", 0),
            "L3": tier_raw.get("L3", 0),
            "unclassified": tier_raw.get("unclassified", 0),
        }

        # Importance histogram
        cursor.execute("""
            SELECT
                SUM(CASE WHEN importance_score >= 0.8 THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN importance_score >= 0.5 AND importance_score < 0.8 THEN 1 ELSE 0 END) as mid,
                SUM(CASE WHEN importance_score < 0.5 AND importance_score IS NOT NULL THEN 1 ELSE 0 END) as low,
                SUM(CASE WHEN importance_score IS NULL THEN 1 ELSE 0 END) as unscored
            FROM chunks
        """)
        imp_row = cursor.fetchone()
        importance_histogram = [
            {"range": "0.8-1.0", "count": int(imp_row["high"] or 0)},
            {"range": "0.5-0.8", "count": int(imp_row["mid"] or 0)},
            {"range": "0.0-0.5", "count": int(imp_row["low"] or 0)},
            {"range": "unscored", "count": int(imp_row["unscored"] or 0)},
        ]

        # Supersession
        cursor.execute("""
            SELECT COUNT(*) as cnt FROM chunks WHERE superseded_by IS NOT NULL
        """)
        superseded_total = int(cursor.fetchone()["cnt"] or 0)
        cursor.execute("""
            SELECT id, superseded_by, superseded_at
            FROM chunks
            WHERE superseded_by IS NOT NULL
            ORDER BY superseded_at DESC
            LIMIT 5
        """)
        recent_superseded = [
            {"id": str(r["id"]), "superseded_by": str(r["superseded_by"]), "superseded_at": r["superseded_at"]}
            for r in cursor.fetchall()
        ]
        supersession = {
            "total_superseded": superseded_total,
            "recent_top5": recent_superseded,
        }

        # Memory graph stats
        cursor.execute("SELECT COUNT(DISTINCT src_chunk_id) + COUNT(DISTINCT tgt_chunk_id) as nodes FROM memory_graph")
        graph_nodes_row = cursor.fetchone()
        cursor.execute("SELECT COUNT(*) as edges FROM memory_graph")
        graph_edges_row = cursor.fetchone()
        cursor.execute("SELECT COUNT(DISTINCT entity) as entities FROM memory_graph")
        graph_entities_row = cursor.fetchone()
        graph_stats = {
            "node_count": int(graph_nodes_row["nodes"] or 0) if graph_nodes_row else 0,
            "edge_count": int(graph_edges_row["edges"] or 0) if graph_edges_row else 0,
            "entity_count": int(graph_entities_row["entities"] or 0) if graph_entities_row else 0,
        }

        # Conflicts
        cursor.execute("SELECT COUNT(*) as total FROM chunk_conflicts")
        conflicts_total = int(cursor.fetchone()["total"] or 0)
        cursor.execute("SELECT COUNT(*) as cnt FROM chunk_conflicts WHERE resolved_at IS NULL")
        conflicts_unresolved = int(cursor.fetchone()["cnt"] or 0)
        cursor.execute("""
            SELECT id, chunk_id_a, chunk_id_b, conflict_reason, detected_at
            FROM chunk_conflicts
            ORDER BY detected_at DESC
            LIMIT 3
        """)
        recent_conflicts = [
            {
                "id": r["id"],
                "chunk_id_a": str(r["chunk_id_a"]),
                "chunk_id_b": str(r["chunk_id_b"]),
                "conflict_reason": str(r["conflict_reason"] or ""),
                "detected_at": r["detected_at"],
            }
            for r in cursor.fetchall()
        ]
        conflicts = {
            "total": conflicts_total,
            "unresolved": conflicts_unresolved,
            "recent_3": recent_conflicts,
        }

        # Heat distribution
        # hot = last_accessed_at > now - 7 days (but not archived)
        # warm = last_accessed_at in 7-30 days (but not archived)
        # archived = archived_at IS NOT NULL
        # cold = everything else (last_accessed_at IS NULL or > 30 days, and not archived)
        cursor.execute(f"""
            SELECT
                SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) as archived,
                SUM(CASE WHEN archived_at IS NULL AND last_accessed_at IS NOT NULL AND last_accessed_at > {seven_days_ago} THEN 1 ELSE 0 END) as hot,
                SUM(CASE WHEN archived_at IS NULL AND last_accessed_at IS NOT NULL AND last_accessed_at <= {seven_days_ago} AND last_accessed_at > {thirty_days_ago} THEN 1 ELSE 0 END) as warm,
                SUM(CASE WHEN archived_at IS NULL AND (last_accessed_at IS NULL OR last_accessed_at <= {thirty_days_ago}) THEN 1 ELSE 0 END) as cold
            FROM chunks
        """)
        heat_row = cursor.fetchone()
        heat_distribution = {
            "hot": int(heat_row["hot"] or 0),
            "warm": int(heat_row["warm"] or 0),
            "cold": int(heat_row["cold"] or 0),
            "archived": int(heat_row["archived"] or 0),
        }

        # Guardian: use memory_benchmarks
        cursor.execute("SELECT MAX(created_at) as last_scan FROM memory_benchmarks")
        guardian_scan_row = cursor.fetchone()
        last_scan_at = guardian_scan_row["last_scan"] if guardian_scan_row else None
        cursor.execute("SELECT COUNT(*) as cnt FROM memory_benchmarks WHERE importance_score < 0.3")
        low_quality_count = int(cursor.fetchone()["cnt"] or 0)
        guardian = {
            "last_scan_at": last_scan_at,
            "low_quality_count": low_quality_count,
        }

    finally:
        conn.close()

    # ── LCM: ob_sessions ──────────────────────────────────────────────────────
    ob_sessions = []
    try:
        lcm_conn = _get_lcm_connection()
        try:
            lcm_cursor = lcm_conn.cursor()
            lcm_cursor.execute("""
                SELECT
                    c.conversation_id,
                    c.session_key,
                    c.title,
                    COUNT(m.message_id) as msg_count,
                    MAX(m.created_at) as last_active_at
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.conversation_id
                WHERE c.session_key LIKE '%:ob'
                GROUP BY c.conversation_id, c.session_key, c.title
                ORDER BY last_active_at DESC
            """)
            for r in lcm_cursor.fetchall():
                ob_sessions.append({
                    "conversation_id": r["conversation_id"],
                    "session_key": str(r["session_key"]),
                    "title": str(r["title"] or ""),
                    "msg_count": int(r["msg_count"] or 0),
                    "last_active_at": r["last_active_at"],
                })
        finally:
            lcm_conn.close()
    except HTTPException:
        # LCM DB not available — return empty ob_sessions
        pass

    return {
        "tier_distribution": tier_distribution,
        "importance_histogram": importance_histogram,
        "supersession": supersession,
        "graph_stats": graph_stats,
        "conflicts": conflicts,
        "heat_distribution": heat_distribution,
        "guardian": guardian,
        "ob_sessions": ob_sessions,
    }
