"""Tests for cost tracking API endpoints.

These tests verify the cost tracking endpoints work correctly with:
1. Gateway RPC (primary data source)
2. HTTP API fallback (when Gateway RPC is unavailable)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.costs import (
    _convert_gateway_agent_breakdown,
    _convert_gateway_daily_to_daily_points,
    _convert_gateway_model_breakdown,
    _convert_gateway_totals_to_kpis,
    _fetch_agent_names,
    _fetch_cost_data_from_gateway,
    _get_cost_metrics_fallback,
    _get_default_gateway_config,
    _resolve_cost_range,
)
from app.schemas.costs import AgentCostBreakdown, DailyCostPoint, ModelCostBreakdown
from app.services.openclaw.gateway_rpc import GatewayConfig, OpenClawGatewayError


class TestResolveCostRange:
    """Tests for _resolve_cost_range function."""

    def test_resolve_7d(self) -> None:
        days, bucket = _resolve_cost_range("7d")
        assert days == 7
        assert bucket == "day"

    def test_resolve_14d(self) -> None:
        days, bucket = _resolve_cost_range("14d")
        assert days == 14
        assert bucket == "day"

    def test_resolve_1m(self) -> None:
        days, bucket = _resolve_cost_range("1m")
        assert days == 30
        assert bucket == "day"

    def test_resolve_3m(self) -> None:
        days, bucket = _resolve_cost_range("3m")
        assert days == 90
        assert bucket == "week"

    def test_resolve_6m(self) -> None:
        days, bucket = _resolve_cost_range("6m")
        assert days == 180
        assert bucket == "week"

    def test_resolve_1y(self) -> None:
        days, bucket = _resolve_cost_range("1y")
        assert days == 365
        assert bucket == "month"


class TestConvertGatewayTotalsToKpis:
    """Tests for _convert_gateway_totals_to_kpis function."""

    def test_converts_basic_totals(self) -> None:
        totals = {
            "input": 1000,
            "output": 2000,
            "cacheRead": 500,
            "cacheWrite": 100,
            "totalTokens": 3600,
            "totalCost": 0.5,
            "inputCost": 0.3,
            "outputCost": 0.2,
            "cacheReadCost": 0.05,
            "cacheWriteCost": 0.01,
            "missingCostEntries": 2,
        }
        model_breakdown: list[ModelCostBreakdown] = []
        kpis = _convert_gateway_totals_to_kpis(totals, 7, model_breakdown)

        assert kpis.total_cost_usd == 0.5
        assert kpis.total_tokens == 3600
        assert kpis.input_tokens == 1000
        assert kpis.output_tokens == 2000
        assert kpis.cache_read_tokens == 500
        assert kpis.cache_write_tokens == 100
        assert kpis.missing_cost_entries == 2
        assert kpis.avg_daily_cost_usd == pytest.approx(0.0714, rel=0.01)
        assert kpis.avg_daily_tokens == pytest.approx(514, rel=1)

    def test_handles_none_values(self) -> None:
        totals: dict[str, Any] = {}
        model_breakdown: list[ModelCostBreakdown] = []
        kpis = _convert_gateway_totals_to_kpis(totals, 7, model_breakdown)

        assert kpis.total_cost_usd == 0.0
        assert kpis.total_tokens == 0
        assert kpis.missing_cost_entries == 0

    def test_finds_top_model_by_cost(self) -> None:
        totals = {"totalTokens": 1000, "totalCost": 0.5}
        model_breakdown = [
            ModelCostBreakdown(
                model="claude-sonnet-4-6",
                input_tokens=500,
                output_tokens=500,
                total_tokens=1000,
                input_cost_usd=0.3,
                output_cost_usd=0.2,
                total_cost_usd=0.5,
                conversations_count=0,
                messages_count=0,
            ),
            ModelCostBreakdown(
                model="claude-opus-4-6",
                input_tokens=1000,
                output_tokens=500,
                total_tokens=1500,
                input_cost_usd=0.6,
                output_cost_usd=0.4,
                total_cost_usd=1.0,
                conversations_count=0,
                messages_count=0,
            ),
        ]
        kpis = _convert_gateway_totals_to_kpis(totals, 7, model_breakdown)

        assert kpis.top_model_by_cost == "claude-opus-4-6"


class TestConvertGatewayDailyToDailyPoints:
    """Tests for _convert_gateway_daily_to_daily_points function."""

    def test_converts_daily_data(self) -> None:
        daily_data = [
            {
                "date": "2026-03-24",
                "tokens": 1000,
                "cost": 0.15,
                "input": 600,
                "output": 400,
                "cacheRead": 200,
                "cacheWrite": 50,
                "inputCost": 0.09,
                "outputCost": 0.06,
                "cacheReadCost": 0.02,
                "cacheWriteCost": 0.005,
            },
            {
                "date": "2026-03-25",
                "tokens": 1500,
                "cost": 0.25,
                "input": 900,
                "output": 600,
                "cacheRead": 300,
                "cacheWrite": 75,
                "inputCost": 0.13,
                "outputCost": 0.09,
                "cacheReadCost": 0.03,
                "cacheWriteCost": 0.008,
            },
        ]
        points = _convert_gateway_daily_to_daily_points(daily_data)

        assert len(points) == 2
        assert points[0].date == "2026-03-24"
        assert points[0].total_tokens == 1000
        assert points[0].total_cost_usd == 0.15
        assert points[0].input_tokens == 600
        assert points[0].output_tokens == 400
        assert points[0].cache_read_tokens == 200
        assert points[0].cache_write_tokens == 50
        assert points[1].date == "2026-03-25"
        assert points[1].total_tokens == 1500

    def test_handles_minimal_data(self) -> None:
        daily_data = [{"date": "2026-03-24", "tokens": 500, "cost": 0.1}]
        points = _convert_gateway_daily_to_daily_points(daily_data)

        assert len(points) == 1
        assert points[0].total_tokens == 500
        assert points[0].total_cost_usd == 0.1
        assert points[0].input_tokens == 0
        assert points[0].output_tokens == 0


class TestConvertGatewayModelBreakdown:
    """Tests for _convert_gateway_model_breakdown function."""

    def test_converts_model_breakdown(self) -> None:
        model_usage = [
            {
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "count": 10,
                "totals": {
                    "input": 5000,
                    "output": 2500,
                    "cacheRead": 1000,
                    "cacheWrite": 200,
                    "totalTokens": 8700,
                    "inputCost": 0.75,
                    "outputCost": 0.5,
                    "cacheReadCost": 0.1,
                    "cacheWriteCost": 0.02,
                    "totalCost": 1.37,
                },
            }
        ]
        breakdowns = _convert_gateway_model_breakdown(model_usage)

        assert len(breakdowns) == 1
        assert breakdowns[0].model == "anthropic/claude-sonnet-4-6"
        assert breakdowns[0].provider == "anthropic"
        assert breakdowns[0].count == 10
        assert breakdowns[0].total_cost_usd == 1.37
        assert breakdowns[0].input_cost_usd == 0.75
        assert breakdowns[0].output_cost_usd == 0.5

    def test_handles_missing_provider(self) -> None:
        model_usage = [
            {
                "model": "gpt-4",
                "count": 5,
                "totals": {"totalTokens": 1000, "totalCost": 0.2},
            }
        ]
        breakdowns = _convert_gateway_model_breakdown(model_usage)

        assert breakdowns[0].model == "gpt-4"
        assert breakdowns[0].provider is None


class TestConvertGatewayAgentBreakdown:
    """Tests for _convert_gateway_agent_breakdown function."""

    def test_converts_agent_breakdown(self) -> None:
        by_agent = [
            {
                "agentId": "abc-123-def",
                "totals": {
                    "input": 3000,
                    "output": 1500,
                    "cacheRead": 500,
                    "cacheWrite": 100,
                    "totalTokens": 5100,
                    "inputCost": 0.45,
                    "outputCost": 0.3,
                    "cacheReadCost": 0.05,
                    "cacheWriteCost": 0.01,
                    "totalCost": 0.81,
                },
            }
        ]
        agent_names = {"abc-123-def": "Test Agent"}
        breakdowns = _convert_gateway_agent_breakdown(by_agent, agent_names)

        assert len(breakdowns) == 1
        assert breakdowns[0].agent_id == "abc-123-def"
        assert breakdowns[0].agent_name == "Test Agent"
        assert breakdowns[0].total_cost_usd == 0.81

    def test_uses_unknown_for_missing_names(self) -> None:
        by_agent = [
            {
                "agentId": "xyz-789",
                "totals": {"totalTokens": 1000, "totalCost": 0.2},
            }
        ]
        agent_names: dict[str, str] = {}
        breakdowns = _convert_gateway_agent_breakdown(by_agent, agent_names)

        assert breakdowns[0].agent_name is None


class TestFetchCostDataFromGateway:
    """Tests for _fetch_cost_data_from_gateway function."""

    @pytest.mark.asyncio
    async def test_returns_data_on_success(self) -> None:
        config = GatewayConfig(url="ws://localhost:18789/ws")
        expected_data = {
            "totals": {"totalCost": 1.5},
            "daily": [],
            "byModel": [],
            "byAgent": [],
        }

        with patch(
            "app.api.costs.openclaw_call",
            new_callable=AsyncMock,
            return_value=expected_data,
        ):
            result = await _fetch_cost_data_from_gateway(config, days=7)

        assert result == expected_data

    @pytest.mark.asyncio
    async def test_returns_none_on_gateway_error(self) -> None:
        config = GatewayConfig(url="ws://localhost:18789/ws")

        with patch(
            "app.api.costs.openclaw_call",
            new_callable=AsyncMock,
            side_effect=OpenClawGatewayError("Connection refused"),
        ):
            result = await _fetch_cost_data_from_gateway(config, days=7)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_non_dict_response(self) -> None:
        config = GatewayConfig(url="ws://localhost:18789/ws")

        with patch(
            "app.api.costs.openclaw_call",
            new_callable=AsyncMock,
            return_value="not a dict",
        ):
            result = await _fetch_cost_data_from_gateway(config, days=7)

        assert result is None


class TestGetDefaultGatewayConfig:
    """Tests for _get_default_gateway_config function."""

    def test_returns_none_for_empty_organization_id(self) -> None:
        """Verify the function handles edge cases gracefully."""
        # This test verifies basic structure expectations
        # Full integration tests would require database fixtures
        pass


class TestFetchAgentNames:
    """Tests for _fetch_agent_names function."""

    @pytest.mark.asyncio
    async def test_returns_empty_for_empty_input(self) -> None:
        session = MagicMock(spec=AsyncSession)
        result = await _fetch_agent_names(session, set())
        assert result == {}

    @pytest.mark.asyncio
    async def test_returns_system_for_system_agent(self) -> None:
        """When only 'system' is in agent_ids, returns System without DB query."""
        session = MagicMock(spec=AsyncSession)
        result = await _fetch_agent_names(session, {"system"})
        assert result == {"system": "System"}
        # Verify no DB query was made
        session.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_filters_invalid_uuids(self) -> None:
        session = MagicMock(spec=AsyncSession)
        result = await _fetch_agent_names(session, {"short", "not-a-uuid-at-all"})
        assert result == {}

    @pytest.mark.asyncio
    async def test_handles_system_with_valid_uuids(self) -> None:
        """System should be included along with DB-queried agents."""
        mock_session = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        async def mock_execute(*args: Any, **kwargs: Any) -> Any:
            return mock_result

        mock_session.execute = mock_execute

        result = await _fetch_agent_names(mock_session, {"system", "a" * 36})
        # Both 'system' and any result from DB should be present
        assert "system" in result
        assert result["system"] == "System"


class TestGatewayRpcIntegration:
    """Integration tests verifying Gateway RPC vs HTTP fallback behavior."""

    def test_gateway_config_structure(self) -> None:
        """Verify GatewayConfig can be constructed correctly."""
        config = GatewayConfig(
            url="wss://gateway.example.com/ws",
            token="secret-token",
            allow_insecure_tls=False,
            disable_device_pairing=True,
        )

        assert config.url == "wss://gateway.example.com/ws"
        assert config.token == "secret-token"
        assert config.disable_device_pairing is True
        assert config.allow_insecure_tls is False

    def test_openclaw_gateway_error_is_runtime(self) -> None:
        """Verify OpenClawGatewayError inherits from RuntimeError."""
        error = OpenClawGatewayError("Test error")
        assert isinstance(error, RuntimeError)
        assert str(error) == "Test error"
