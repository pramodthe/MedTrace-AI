"""
Langtrace OpenTelemetry tracing for LLM / LangChain / LangGraph calls.

**Import and call ``init_langtrace()`` before any LangChain, LangGraph, or Deep Agents
imports** — required by the Langtrace Python SDK so instrumentations hook correctly.

See: https://github.com/Scale3-Labs/langtrace-python-sdk

Optional alternative (LangSmith, not Langtrace): set ``LANGCHAIN_TRACING_V2=true``,
``LANGSMITH_API_KEY``, and ``LANGSMITH_PROJECT`` per LangChain docs — do not enable both
unless you intend to dual-export traces.
"""

from __future__ import annotations

import logging
import os

_logger = logging.getLogger(__name__)
_initialized = False


def init_langtrace() -> bool:
    """
    Initialize Langtrace when ``LANGTRACE_API_KEY`` is set.

    Returns True if the SDK ran ``langtrace.init``, False if skipped or unavailable.
    Safe to call multiple times (idempotent).
    """
    global _initialized
    if _initialized:
        return True

    key = (os.environ.get("LANGTRACE_API_KEY") or "").strip()
    if not key:
        return False

    try:
        from langtrace_python_sdk import langtrace
    except ImportError:
        _logger.warning(
            "LANGTRACE_API_KEY is set but langtrace-python-sdk is not installed. "
            "Install with: pip install langtrace-python-sdk"
        )
        return False

    service = (os.environ.get("LANGTRACE_SERVICE_NAME") or "medtrace-agent").strip()
    api_host = (os.environ.get("LANGTRACE_API_HOST") or "").strip() or None

    kwargs: dict = {
        "api_key": key,
        "service_name": service,
    }
    if api_host:
        kwargs["api_host"] = api_host

    langtrace.init(**kwargs)
    _initialized = True
    _logger.info("Langtrace initialized (service_name=%s)", service)
    return True


def langtrace_active() -> bool:
    return _initialized
