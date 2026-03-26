"""OpenClaw Usage API client for fetching cost tracking data.

This module provides a client to interact with the OpenClaw Gateway's Usage API
to retrieve accurate cost tracking data including model-level breakdowns.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class OpenClawAPIError(Exception):
    """Base exception for OpenClaw API errors."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenClawClient:
    """Client for interacting with OpenClaw Usage API.

    The OpenClaw Gateway provides usage tracking through JSON-RPC style endpoints.
    This client wraps those endpoints with proper error handling and timeouts.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: int | None = None,
    ) -> None:
        """Initialize the OpenClaw API client.

        Args:
            base_url: The base URL of the OpenClaw Gateway. Defaults to settings.openclaw_api_url.
            timeout: Request timeout in seconds. Defaults to settings.openclaw_api_timeout.
        """
        self.base_url = (base_url or settings.openclaw_api_url).rstrip("/")
        self.timeout = timeout or settings.openclaw_api_timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _call_method(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Call a JSON-RPC method on the OpenClaw Gateway.

        Args:
            method: The JSON-RPC method name (e.g., "usage.cost", "sessions.usage").
            params: Optional parameters for the method.

        Returns:
            The result data from the response.

        Raises:
            OpenClawAPIError: If the API request fails or returns an error.
        """
        client = await self._get_client()

        payload = {
            "method": method,
            "params": params or {},
        }

        try:
            response = await client.post("/", json=payload)
            response.raise_for_status()

            data = response.json()

            # OpenClaw JSON-RPC responses have the structure:
            # { "success": bool, "result": any, "error": any }
            if not data.get("success"):
                error = data.get("error", {})
                error_msg = (
                    error.get("message") if isinstance(error, dict) else str(error)
                )
                raise OpenClawAPIError(f"OpenClaw API error: {error_msg}")

            return data.get("result", {})

        except httpx.HTTPStatusError as e:
            raise OpenClawAPIError(
                f"HTTP error from OpenClaw API: {e.response.status_code}",
                status_code=e.response.status_code,
            ) from e
        except httpx.RequestError as e:
            raise OpenClawAPIError(f"Failed to connect to OpenClaw API: {e}") from e

    async def get_usage_cost(
        self,
        *,
        days: int | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        mode: str = "utc",
        utc_offset: str | None = None,
    ) -> dict[str, Any]:
        """Get cost usage summary from OpenClaw.

        Args:
            days: Number of days to look back (default: 30).
            start_date: Start date in YYYY-MM-DD format.
            end_date: End date in YYYY-MM-DD format.
            mode: Date interpretation mode ("utc", "gateway", or "specific").
            utc_offset: UTC offset string (e.g., "UTC+8" for Beijing time).

        Returns:
            CostUsageSummary dict with fields:
                - updatedAt: int (timestamp)
                - days: int
                - daily: list of daily entries
                - totals: aggregated totals

        Raises:
            OpenClawAPIError: If the API request fails.
        """
        params: dict[str, Any] = {"mode": mode}

        if days is not None:
            params["days"] = days
        if start_date:
            params["startDate"] = start_date
        if end_date:
            params["endDate"] = end_date
        if utc_offset:
            params["utcOffset"] = utc_offset

        return await self._call_method("usage.cost", params)

    async def get_sessions_usage(
        self,
        *,
        days: int | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        mode: str = "utc",
        utc_offset: str | None = None,
        limit: int = 50,
        key: str | None = None,
        include_context_weight: bool = False,
    ) -> dict[str, Any]:
        """Get sessions usage data from OpenClaw.

        Args:
            days: Number of days to look back (default: 30).
            start_date: Start date in YYYY-MM-DD format.
            end_date: End date in YYYY-MM-DD format.
            mode: Date interpretation mode ("utc", "gateway", or "specific").
            utc_offset: UTC offset string (e.g., "UTC+8" for Beijing time).
            limit: Maximum number of sessions to return (default: 50).
            key: Specific session key to query.
            include_context_weight: Whether to include context weight data.

        Returns:
            SessionsUsageResult dict with fields:
                - updatedAt: int (timestamp)
                - startDate: str (YYYY-MM-DD)
                - endDate: str (YYYY-MM-DD)
                - sessions: list of session entries
                - totals: aggregated totals
                - aggregates: detailed breakdowns by model, provider, agent, etc.

        Raises:
            OpenClawAPIError: If the API request fails.
        """
        params: dict[str, Any] = {
            "mode": mode,
            "limit": limit,
            "includeContextWeight": include_context_weight,
        }

        if days is not None:
            params["days"] = days
        if start_date:
            params["startDate"] = start_date
        if end_date:
            params["endDate"] = end_date
        if utc_offset:
            params["utcOffset"] = utc_offset
        if key:
            params["key"] = key

        return await self._call_method("sessions.usage", params)

    async def get_session_timeseries(
        self,
        key: str,
        max_points: int = 200,
    ) -> dict[str, Any]:
        """Get usage time series for a specific session.

        Args:
            key: The session key.
            max_points: Maximum number of data points to return.

        Returns:
            SessionUsageTimeSeries dict with timestamp-based usage data.

        Raises:
            OpenClawAPIError: If the API request fails.
        """
        params = {
            "key": key,
            "maxPoints": max_points,
        }

        return await self._call_method("sessions.usage.timeseries", params)

    async def get_session_logs(
        self,
        key: str,
        limit: int = 200,
    ) -> dict[str, Any]:
        """Get detailed logs for a specific session.

        Args:
            key: The session key.
            limit: Maximum number of log entries to return (max 1000).

        Returns:
            Dict with "logs" key containing a list of SessionLogEntry.

        Raises:
            OpenClawAPIError: If the API request fails.
        """
        params = {
            "key": key,
            "limit": min(limit, 1000),  # OpenClaw caps at 1000
        }

        return await self._call_method("sessions.usage.logs", params)


def get_date_range_for_days(days: int) -> tuple[str, str]:
    """Calculate date range for the last N days.

    Args:
        days: Number of days to look back.

    Returns:
        A tuple of (start_date, end_date) in YYYY-MM-DD format.
    """
    end = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days - 1)

    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


async def get_openclaw_client() -> OpenClawClient:
    """Factory function to get an OpenClaw client instance.

    This is useful for dependency injection in FastAPI routes.

    Returns:
        An OpenClawClient instance.
    """
    return OpenClawClient()
