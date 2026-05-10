"""Shared pytest fixtures for backend tests."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_ROOT / ".env", override=True)
load_dotenv(_ROOT / ".env.local", override=True)

# Langtrace before any LangChain / LangGraph agent imports.
from medtrace_agent.tracing import init_langtrace

init_langtrace()

import pytest


@pytest.fixture(autouse=True)
def clear_zep_lru_cache() -> None:
    """Isolate tests that patch ``get_zep_client`` or env-based client creation."""
    from medtrace_agent.zep import memory

    memory.get_zep_client.cache_clear()
    yield
    memory.get_zep_client.cache_clear()


@pytest.fixture(autouse=True)
def clear_deep_agent_graph_cache() -> None:
    from medtrace_agent.agents import deep_clinical

    deep_clinical.GRAPH_CACHE.clear()
    yield
    deep_clinical.GRAPH_CACHE.clear()
