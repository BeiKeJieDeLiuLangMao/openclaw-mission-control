"""Helpers for extracting and matching `@mention` tokens in text."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from app.models.agents import Agent

# Mention tokens are single, space-free words (e.g. "@alex", "@lead", "@商品详情PM").
# Supports Unicode characters (Chinese, CJK, etc.).
# Uses Unicode property matching to include letters/numbers from all languages.
MENTION_PATTERN = re.compile(
    r"@"
    r"([a-zA-Z0-9_\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af-]{1,32})"
    r"(?=[\s@、，,。！？.!?]|$)",
    re.UNICODE,
)


def extract_mentions(message: str) -> set[str]:
    """Extract normalized mention handles from a message body."""
    return {match.group(1).strip().lower() for match in MENTION_PATTERN.finditer(message)}


def matches_agent_mention(agent: Agent, mentions: set[str]) -> bool:
    """Return whether a mention set targets the provided agent."""
    if not mentions:
        return False

    # "@lead" is a reserved shortcut that always targets the board lead.
    if "lead" in mentions and agent.is_board_lead:
        return True
    mentions = mentions - {"lead"}

    name = (agent.name or "").strip()
    if not name:
        return False

    normalized = name.lower()
    if normalized in mentions:
        return True

    # Support mentions without spaces for multi-word names (e.g. "@missioncontrolpm" matches "Mission Control PM").
    normalized_no_space = normalized.replace(" ", "")
    if normalized_no_space in mentions:
        return True

    # Mentions are single tokens; match on first name for display names with spaces.
    first = normalized.split()[0]
    return first in mentions
