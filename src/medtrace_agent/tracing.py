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


def langsmith_active() -> bool:
    """Return True iff LangSmith env vars are present so LangChain will auto-trace."""
    tracing = (os.environ.get("LANGSMITH_TRACING") or os.environ.get("LANGCHAIN_TRACING_V2") or "").strip().lower()
    key = (os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY") or "").strip()
    return tracing in ("true", "1", "yes") and bool(key)


def log_tracing_status(logger: logging.Logger | None = None) -> None:
    """One-shot startup log: which tracer (if any) is wired up."""
    log = logger or _logger
    if langsmith_active():
        project = (os.environ.get("LANGSMITH_PROJECT") or "default").strip()
        log.warning(
            "LangSmith tracing ENABLED → project=%s, dashboard=https://smith.langchain.com/o/-/projects/p/%s",
            project,
            project,
        )
    elif langtrace_active():
        log.warning("Langtrace tracing ENABLED")
    else:
        log.warning(
            "No tracing exporter active. To enable LangSmith, set LANGSMITH_API_KEY in .env "
            "(LANGSMITH_TRACING=true is already set)."
        )
