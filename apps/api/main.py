"""FastAPI entry point for the Medtrace React Frontend.

Run::

    uvicorn apps.api.main:app --reload --port 8000

The Streamlit app at ``apps/streamlit_app.py`` continues to work in parallel —
both share the same ``src/medtrace_agent`` package and the same Zep / InsForge
backends.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Repo layout: .../<repo>/apps/api/main.py → add .../<repo>/src for imports.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    _src_s = str(_SRC)
    if _src_s not in sys.path:
        sys.path.insert(0, _src_s)

from dotenv import load_dotenv

# ``override=True`` matches the Streamlit app's behaviour.
load_dotenv(_REPO_ROOT / ".env", override=True)
load_dotenv(_REPO_ROOT / ".env.local", override=True)

# Optional: Langtrace must be initialised before LangChain / LangGraph imports.
# LangSmith is auto-instrumented by LangChain when LANGSMITH_TRACING + LANGSMITH_API_KEY
# are present in the environment — load_dotenv above puts them there before any
# LangChain modules are imported, so the auto-tracer picks them up.
from medtrace_agent.tracing import init_langtrace, log_tracing_status  # noqa: E402

init_langtrace()
log_tracing_status()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from apps.api.routers import clinical, documents, patients, threads  # noqa: E402


def _cors_origins() -> list[str]:
    raw = os.environ.get("API_CORS_ORIGINS") or "http://localhost:3000,http://127.0.0.1:3000"
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(
    title="Medtrace API",
    version="0.1.0",
    description=(
        "Bridges the React Frontend to Zep Cloud (memory + graph), "
        "Fireworks AI (LLM + VLM), and InsForge (Postgres + Storage). "
        "Single-demo-profile mode."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, object]:
    """Liveness + sanity checks (does not call out to Zep / Fireworks)."""
    from medtrace_agent.insforge_api import insforge_persistence_enabled

    return {
        "status": "ok",
        "insforge_configured": insforge_persistence_enabled(),
        "fireworks_configured": bool(os.environ.get("FIREWORKS_API_KEY")),
        "zep_configured": bool(os.environ.get("ZEP_API_KEY")),
        "demo_profile_id_set": bool(os.environ.get("INSFORGE_PROFILE_ID")),
    }


app.include_router(patients.router)
app.include_router(documents.router)
app.include_router(threads.router)
app.include_router(clinical.router)
