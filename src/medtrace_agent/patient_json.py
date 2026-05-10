"""
Structured patient definition for the Streamlit demo — parsed from JSON.

This is **not** a clinical record or FHIR resource; it only drives Zep ``user_id``,
display name, and optional demo metadata persisted on ``chart_subjects.metadata``.

Do not put real PHI in JSON or in the app.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class PatientDemographics(BaseModel):
    """Synthetic / demo-only demographic hints (no identifiers)."""

    model_config = ConfigDict(extra="forbid")

    age_band: str | None = Field(
        None,
        description='Approximate band label, e.g. "40-49" (demo only).',
    )
    locale: str | None = Field(
        None,
        description='Optional locale hint, e.g. "en-US" (non-clinical).',
    )


class PatientJson(BaseModel):
    """
    JSON shape for creating or updating the active **patient** (Zep user + labels).

    Required for Zep + graph routing:
    - ``zep_user_id``: stable string used as Zep Cloud **User** id.

    Optional InsForge ``chart_subjects.metadata`` stores the full normalized dict
    (minus redundant top-level keys we store in columns).
    """

    model_config = ConfigDict(extra="forbid")

    zep_user_id: str = Field(
        ...,
        min_length=1,
        description="Stable identifier for the Zep user / knowledge-graph owner (string).",
    )
    display_name: str = Field(
        "",
        description="Human-readable name shown in the UI and passed to Zep `ensure_user`.",
    )
    notes: str | None = Field(
        None,
        description="Short demo note (non-clinical, non-PHI).",
    )
    tags: list[str] = Field(
        default_factory=list,
        description='Labels for your own organization, e.g. ["synthetic","cohort-a"].',
    )
    cohort: str | None = Field(
        None,
        description='Optional cohort or study label for demos, e.g. "demo-2026-01".',
    )
    scenario: str | None = Field(
        None,
        description="Optional one-line description of the synthetic scenario.",
    )
    demographics: PatientDemographics | None = Field(
        None,
        description="Optional non-identifying demographic hints.",
    )
    preferences: dict[str, str] = Field(
        default_factory=dict,
        description='Small key/value map for UI hints (strings only), e.g. {"chart_color":"blue"}.',
    )
    extra: dict[str, Any] = Field(
        default_factory=dict,
        description="Forward-compatible bag for any additional JSON-safe fields.",
    )


def patient_json_schema() -> dict[str, Any]:
    """JSON Schema for ``PatientJson`` (for docs / Streamlit)."""
    return PatientJson.model_json_schema()


def default_patient_example() -> dict[str, Any]:
    """Example object matching :class:`PatientJson` for prefilling the UI."""
    return {
        "zep_user_id": "demo-patient-synthetic-001",
        "display_name": "Alex Demo",
        "notes": "Synthetic demo patient — not a real individual.",
        "tags": ["synthetic", "streamlit-demo"],
        "cohort": "internal-demo",
        "scenario": "Chronic-care dialogue smoke test",
        "demographics": {"age_band": "50-59", "locale": "en-US"},
        "preferences": {"sidebar_compact": "false"},
        "extra": {"seed_run_id": "example-001"},
    }


def parse_patient_json(raw: str) -> PatientJson:
    """Parse and validate a JSON string into :class:`PatientJson`."""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Patient JSON must be a JSON object at the root.")
    return PatientJson.model_validate(data)


def patient_metadata_blob(record: PatientJson) -> dict[str, Any]:
    """Serialize patient fields suitable for ``chart_subjects.metadata`` (JSON object)."""
    d = record.model_dump(mode="json", exclude_none=True)
    # Columns chart_subjects.zep_user_id / display_name duplicate; metadata keeps the rest + full snapshot.
    return d


def format_validation_error(err: ValidationError) -> str:
    lines = []
    for e in err.errors():
        loc = ".".join(str(x) for x in e.get("loc", ()))
        lines.append(f"- `{loc}`: {e.get('msg', '')}")
    return "\n".join(lines) if lines else str(err)
