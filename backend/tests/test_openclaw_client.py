"""Tests for OpenClaw API client."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.openclaw_client import (
    OpenClawAPIError,
    OpenClawClient,
    get_date_range_for_days,
)


@pytest.fixture
def client() -> OpenClawClient:
    """Create a test OpenClaw client."""
    return OpenClawClient(base_url="http://test.local", timeout=10)


class TestOpenClawClient:
    """Test suite for OpenClawClient."""

    @pytest.mark.asyncio
    async def test_init_default_settings(self, settings_with_env) -> None:
        """Test client initialization with default settings."""
        client = OpenClawClient()
        assert client.base_url == "http://127.0.0.1:18789"
        assert client.timeout == 30
        await client.close()

    @pytest.mark.asyncio
    async def test_init_custom_settings(self) -> None:
        """Test client initialization with custom settings."""
        client = OpenClawClient(base_url="http://custom:8080", timeout=60)
        assert client.base_url == "http://custom:8080"
        assert client.timeout == 60
        await client.close()

    @pytest.mark.asyncio
    async def test_call_method_success(self, client: OpenClawClient) -> None:
        """Test successful JSON-RPC method call."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "result": {"data": "test_value"},
        }

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(client, "_get_client", return_value=mock_client):
            result = await client._call_method("test.method", {"param": "value"})

            assert result == {"data": "test_value"}
            mock_client.post.assert_called_once_with(
                "/",
                json={"method": "test.method", "params": {"param": "value"}},
            )

    @pytest.mark.asyncio
    async def test_call_method_api_error(self, client: OpenClawClient) -> None:
        """Test API error response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": False,
            "error": {"message": "Invalid request"},
        }

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(client, "_get_client", return_value=mock_client):
            with pytest.raises(OpenClawAPIError) as exc_info:
                await client._call_method("test.method")

            assert "OpenClaw API error" in str(exc_info.value)
            assert "Invalid request" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_call_method_http_error(self, client: OpenClawClient) -> None:
        """Test HTTP error response."""
        mock_response = MagicMock()
        mock_response.status_code = 503
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Service Unavailable", request=MagicMock(), response=mock_response
        )

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(client, "_get_client", return_value=mock_client):
            with pytest.raises(OpenClawAPIError) as exc_info:
                await client._call_method("test.method")

            assert exc_info.value.status_code == 503
            assert "HTTP error" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_call_method_connection_error(self, client: OpenClawClient) -> None:
        """Test connection error."""
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(
            side_effect=httpx.RequestError("Connection failed")
        )

        with patch.object(client, "_get_client", return_value=mock_client):
            with pytest.raises(OpenClawAPIError) as exc_info:
                await client._call_method("test.method")

            assert "Failed to connect" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_usage_cost(self, client: OpenClawClient) -> None:
        """Test get_usage_cost method."""
        expected_result = {
            "updatedAt": 1234567890,
            "days": 7,
            "daily": [
                {"date": "2026-03-20", "tokens": 1000, "cost": 0.01},
            ],
            "totals": {
                "input": 500,
                "output": 500,
                "totalTokens": 1000,
                "totalCost": 0.01,
            },
        }

        with patch.object(client, "_call_method", return_value=expected_result):
            result = await client.get_usage_cost(days=7)

            assert result == expected_result

    @pytest.mark.asyncio
    async def test_get_sessions_usage(self, client: OpenClawClient) -> None:
        """Test get_sessions_usage method."""
        expected_result = {
            "updatedAt": 1234567890,
            "startDate": "2026-03-18",
            "endDate": "2026-03-25",
            "sessions": [],
            "totals": {"input": 500, "output": 500, "totalTokens": 1000},
            "aggregates": {
                "byModel": [],
                "byProvider": [],
                "byAgent": [],
            },
        }

        with patch.object(client, "_call_method", return_value=expected_result):
            result = await client.get_sessions_usage(days=7, limit=100)

            assert result == expected_result

    @pytest.mark.asyncio
    async def test_close(self, client: OpenClawClient) -> None:
        """Test client close method."""
        mock_http_client = AsyncMock()
        mock_http_client.aclose = AsyncMock()

        client._client = mock_http_client
        await client.close()

        mock_http_client.aclose.assert_called_once()
        assert client._client is None


class TestUtilityFunctions:
    """Test suite for utility functions."""

    def test_get_date_range_for_days(self) -> None:
        """Test date range calculation."""
        start, end = get_date_range_for_days(7)

        # Check format
        assert len(start) == 10  # YYYY-MM-DD
        assert len(end) == 10

        # Check that start is before end
        assert start < end

        # Check approximate range (end should be today/tomorrow)
        from datetime import datetime, timedelta

        expected_end = datetime.now().strftime("%Y-%m-%d")
        expected_start = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")

        assert end == expected_end
        assert start == expected_start

    def test_get_date_range_for_days_single(self) -> None:
        """Test date range for single day."""
        start, end = get_date_range_for_days(1)

        # For 1 day, start and end should be the same
        assert start == end
