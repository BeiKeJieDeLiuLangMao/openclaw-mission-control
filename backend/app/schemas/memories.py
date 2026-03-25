"""Memory visualization schemas for MemOS data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class MemoryStats:
    """Memory statistics across all agents."""

    total_memories: int
    memories_with_embeddings: int
    total_agents: int


@dataclass(frozen=True)
class AgentMemoryStats:
    """Memory statistics for a single agent."""

    agent_id: str
    memory_count: int
    embedding_count: int
    name: str | None = None  # Human-readable agent name


@dataclass(frozen=True)
class MemoryItem:
    """A single memory chunk."""

    id: str
    owner: str
    summary: str
    content_preview: str
    created_at: datetime
    has_embedding: bool
    task_id: str | None
    tier: str | None = None
    tier_reason: str | None = None
    agent_id: str | None = None


@dataclass(frozen=True)
class MemoryListResponse:
    """Response model for memory list endpoint."""

    items: list[MemoryItem]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True)
class RecallLogItem:
    """A single recall (memory_search) log entry."""

    id: int
    query: str
    hit_count: int
    duration_ms: int
    called_at: datetime


@dataclass(frozen=True)
class RecallLogResponse:
    """Response model for recall log endpoint."""

    items: list[RecallLogItem]
    total: int
    limit: int


@dataclass(frozen=True)
class TierAgentStats:
    """Memory statistics for a single agent within a tier."""

    agent_id: str
    memory_count: int


@dataclass(frozen=True)
class TierStats:
    """Memory statistics for a single tier."""

    tier: str
    memory_count: int
    agents: list[TierAgentStats]


@dataclass(frozen=True)
class TierListResponse:
    """Response model for tier statistics endpoint."""

    tiers: list[TierStats]


@dataclass(frozen=True)
class WorkspaceFileInfo:
    """Information about a workspace file."""

    name: str
    path: str
    size: int
    modified_at: datetime


@dataclass(frozen=True)
class AgentWorkspace:
    """A single agent's workspace."""

    agent_id: str
    agent_name: str | None
    files: list[WorkspaceFileInfo]


@dataclass(frozen=True)
class WorkspaceFilesResponse:
    """Response model for workspace files list endpoint."""

    workspaces: list[AgentWorkspace]


@dataclass(frozen=True)
class WorkspaceFileContentResponse:
    """Response model for workspace file content endpoint."""

    content: str
    path: str


@dataclass(frozen=True)
class LCMSummaryItem:
    """A single LCM (lossless-claw) summary."""

    summary_id: str
    session_key: str
    agent_name: str | None
    kind: str  # "leaf" or "condensed"
    depth: int
    token_count: int
    earliest_at: datetime
    latest_at: datetime
    descendant_count: int
    content_preview: str


@dataclass(frozen=True)
class LCMSummaryDetail:
    """Detailed LCM summary with full content and relationships."""

    summary_id: str
    session_key: str
    kind: str
    depth: int
    token_count: int
    earliest_at: datetime
    latest_at: datetime
    descendant_count: int
    content: str
    parent_ids: list[str]
    child_ids: list[str]


@dataclass(frozen=True)
class LCMAgentItem:
    """A single agent with LCM records."""

    session_key: str
    agent_name: str | None
    count: int


@dataclass(frozen=True)
class LCMSummaryListResponse:
    """Response model for LCM summary list endpoint."""

    items: list[LCMSummaryItem]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True)
class LCMDepthBucket:
    """A bucket showing count of summaries at a given kind+depth."""

    kind: str
    depth: int
    count: int


@dataclass(frozen=True)
class LCMSessionProgress:
    """LCM progress stats for a single session/agent."""

    session_key: str
    agent_name: str | None
    message_count: int
    token_count: int
    leaf_count: int
    condensed_count: int
    processed_messages: int
    last_updated: str | None
    raw_tokens_outside_tail: int = 0  # uncompressed token sum outside freshTail


@dataclass(frozen=True)
class LCMConfig:
    """lossless-claw configuration values from openclaw.json."""

    fresh_tail_count: int
    leaf_chunk_tokens: int


@dataclass(frozen=True)
class LCMStatsOverview:
    """Top-level overview counts for LCM compression."""

    conversations: int
    messages: int
    summaries_leaf: int
    summaries_condensed: int


@dataclass(frozen=True)
class LCMStatsResponse:
    """Response model for the LCM stats endpoint."""

    overview: LCMStatsOverview
    sessions: list[LCMSessionProgress]
    depth_distribution: list[LCMDepthBucket]
    config: LCMConfig | None = None
