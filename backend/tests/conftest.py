# ruff: noqa: INP001
"""Pytest configuration shared across backend tests."""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Tests should fail fast if auth-mode wiring breaks, but still need deterministic
# defaults during import-time settings initialization, regardless of shell env.
os.environ["AUTH_MODE"] = "local"
os.environ["LOCAL_AUTH_TOKEN"] = "test-local-token-0123456789-0123456789-0123456789x"
os.environ["BASE_URL"] = "http://localhost:8000"


@pytest.fixture
def settings_with_env():
    """Provide test settings with required environment variables.

    This fixture ensures all required environment variables are set for Settings
    initialization during tests.
    """
    # Ensure all required env vars are set
    env_vars = {
        "AUTH_MODE": "local",
        "LOCAL_AUTH_TOKEN": "test-local-token-0123456789-0123456789-0123456789x",
        "BASE_URL": "http://localhost:8000",
    }

    original_env = {}
    for key, value in env_vars.items():
        original_env[key] = os.environ.get(key)
        os.environ[key] = value

    yield env_vars

    # Restore original environment
    for key, original_value in original_env.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value

