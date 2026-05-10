"""Shared FastAPI dependencies: env-loaded config + per-request helpers."""

from __future__ import annotations

import os
from functools import lru_cache

from fastapi import Depends, HTTPException, status

from medtrace_agent.insforge_api import insforge_persistence_enabled


@lru_cache(maxsize=1)
def get_demo_profile_id() -> str:
    """Read the seeded demo profile id from env (single-profile mode)."""
    pid = (os.environ.get("INSFORGE_PROFILE_ID") or "").strip()
    if not pid:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "INSFORGE_PROFILE_ID is not set. Seed a profiles row and add the "
                "uuid to the root .env (see DBMS-design.md)."
            ),
        )
    return pid


def require_insforge_enabled() -> None:
    if not insforge_persistence_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "InsForge persistence is not configured. Set INSFORGE_URL, "
                "INSFORGE_API_KEY, INSFORGE_PROFILE_ID in .env."
            ),
        )


ProfileIdDep = Depends(get_demo_profile_id)
RequireInsforgeDep = Depends(require_insforge_enabled)
