"""Imaging routes: DICOM study upload, MedSAM2 segmentation, draft report generation.

Independent of the clinical routes — no InsForge or Zep involvement. Studies are files
under ``data/studies/`` (see ``medtrace_agent.imaging.storage``), served at ``/data``.
Every model call degrades to deterministic mock output when no provider is configured,
so these routes work with no secrets at all.
"""

from __future__ import annotations

from shutil import copyfileobj
from time import time

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from apps.api.schemas import (
    ReportOut,
    ReportRequest,
    SegmentationOut,
    SegmentationRequest,
    StudyOut,
)
from medtrace_agent.imaging import (
    MedGemmaService,
    MedSAM2Service,
    is_dicom_file,
    render_dicom_preview,
    study_dir,
)
from medtrace_agent.imaging.storage import study_preview_url

router = APIRouter(prefix="/api/studies", tags=["imaging"])

medsam2_service = MedSAM2Service()
medgemma_service = MedGemmaService()


@router.post("", response_model=StudyOut, status_code=status.HTTP_201_CREATED)
async def create_study(file: UploadFile = File(...)) -> StudyOut:
    """Store an uploaded DICOM file and render its preview PNG."""
    filename = file.filename or "uploaded-study"
    study_id = f"ST-{int(time())}"
    target_dir = study_dir(study_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    stored_path = target_dir / filename

    with stored_path.open("wb") as output:
        copyfileobj(file.file, output)

    if not is_dicom_file(stored_path):
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only DICOM uploads are supported. Please upload a valid .dcm study file.",
        )

    metadata = render_dicom_preview(stored_path, target_dir)
    return StudyOut(
        id=study_id,
        uploaded_file_name=filename,
        preview_url=study_preview_url(study_id),
        **metadata,
    )


@router.post("/{study_id}/segmentations/medsam2", response_model=SegmentationOut)
def segment_with_medsam2(study_id: str, request: SegmentationRequest) -> SegmentationOut:
    result = medsam2_service.segment(study_id=study_id, prompt=request.prompt)
    result.setdefault("box", request.prompt.model_dump())
    return SegmentationOut(**result)


@router.post("/{study_id}/reports/qwen-vl", response_model=ReportOut)
def report_with_qwen_vl(study_id: str, request: ReportRequest) -> ReportOut:
    try:
        result = medgemma_service.generate_report(study_id=study_id, request=request)
    except Exception as exc:  # noqa: BLE001 — upstream provider failure
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Report generation failed: {exc}",
        ) from exc
    return ReportOut(**result)


@router.post("/{study_id}/reports/medgemma", response_model=ReportOut)
def report_with_medgemma(study_id: str, request: ReportRequest) -> ReportOut:
    """Alias kept for the MedGemma adapter path; resolves the same provider ladder."""
    return report_with_qwen_vl(study_id, request)
