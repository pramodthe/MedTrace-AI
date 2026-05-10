"""Pydantic schemas shared between FastAPI routers and the React Frontend.

Field names mirror the existing ``Frontend/src/data/mockData.ts`` mock types so
swap-in is one-for-one without UI changes.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentKind = Literal["clinical_pdf", "radiology_note", "conversation_note"]
RiskLevel = Literal["High", "Medium", "Low"]
LabStatus = Literal["High", "Normal", "Low", "Borderline"]
TrendDirection = Literal["Worsening", "Improving", "Stable"]
DocumentStatus = Literal["Processed", "Processing"]


class PatientOut(BaseModel):
    """Patient directory row + chart detail header."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="chart_subjects.id (uuid)")
    zep_user_id: str
    name: str = Field(..., description="display name")
    age: int = 0
    sex: Literal["M", "F", "O"] = "O"
    dob: str | None = None
    primary_doctor: str | None = None
    last_visit: str | None = None
    last_updated: str | None = None
    document_count: int = 0
    conditions: int = 0
    risk: RiskLevel = "Low"
    summary: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreatePatientIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zep_user_id: str
    display_name: str
    age: int | None = None
    sex: Literal["M", "F", "O"] | None = None
    dob: str | None = None
    primary_doctor: str | None = None
    notes: str | None = None
    tags: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    filename: str
    document_kind: DocumentKind
    extract_mode: str | None = None
    episode_count: int = 0
    storage_url: str | None = None
    storage_key: str | None = None
    storage_bucket: str | None = None
    uploaded_at: str
    status: DocumentStatus = "Processed"
    review_status: str = "Needs review"


class IngestResult(BaseModel):
    document: DocumentOut
    episode_ids: list[str] = Field(default_factory=list)


class ChatMessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: str | None = None
    name: str | None = None


class ChatThreadOut(BaseModel):
    id: str = Field(..., description="chat_sessions.id")
    zep_thread_id: str
    title: str | None = None
    created_at: str
    updated_at: str


class CreateThreadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None


class SendMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_input: str
    deep: bool = False


class SendMessageOut(BaseModel):
    user: ChatMessageOut
    assistant: ChatMessageOut


class TimelineEvent(BaseModel):
    date: str
    events: list[str]


class LabTrendOut(BaseModel):
    test: str
    latest: str
    previous: str | None = None
    status: LabStatus = "Normal"
    trend: TrendDirection = "Stable"
    date: str | None = None
    range: str | None = None
    source: str | None = None


class ConditionOut(BaseModel):
    name: str
    status: str = "Active"
    first_seen: str | None = None
    last_mentioned: str | None = None


class MedicationOut(BaseModel):
    name: str
    dose: str | None = None
    frequency: str | None = None
    status: Literal["Active", "Previous"] = "Active"
    start: str | None = None
    end: str | None = None


class AllergyOut(BaseModel):
    allergen: str
    reaction: str | None = None
    source: str | None = None


class AbnormalFindingOut(BaseModel):
    test: str
    value: str
    status: str
    source: str | None = None


class AlertOut(BaseModel):
    message: str
    priority: RiskLevel
    type: str
    evidence: str | None = None


class InsightOut(BaseModel):
    title: str
    detail: str
    evidence: list[str] = Field(default_factory=list)
    priority: RiskLevel = "Medium"


class ClinicalSnapshotOut(BaseModel):
    """Aggregated dashboard payload used by ``DashboardHome``."""

    patient: PatientOut
    insights: list[InsightOut] = Field(default_factory=list)
    active_conditions: list[ConditionOut] = Field(default_factory=list)
    current_medications: list[MedicationOut] = Field(default_factory=list)
    allergies: list[AllergyOut] = Field(default_factory=list)
    recent_abnormal: list[AbnormalFindingOut] = Field(default_factory=list)
    risk_alerts: list[AlertOut] = Field(default_factory=list)
    lab_trends: list[LabTrendOut] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    documents: list[DocumentOut] = Field(default_factory=list)
    doctor_checklist: list[str] = Field(default_factory=list)
