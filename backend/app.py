from __future__ import annotations

import os
from pathlib import Path
from shutil import copy2, copyfileobj
from time import time
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from model_adapters import MedGemmaService, MedSAM2Service


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

BACKEND_DIR = Path(__file__).resolve().parent
load_env_file(BACKEND_DIR.parent / ".env")
load_env_file(BACKEND_DIR / ".env")

app = FastAPI(title="Med AI Backend", version="0.1.0")
medsam2_service = MedSAM2Service()
medgemma_service = MedGemmaService()
DATA_DIR = Path(__file__).resolve().parent / "data"
STUDIES_DIR = DATA_DIR / "studies"
STUDIES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
        "http://127.0.0.1:5176",
        "http://localhost:5176",
        "http://127.0.0.1:5177",
        "http://localhost:5177",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RoiPrompt(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class SegmentationRequest(BaseModel):
    prompt: RoiPrompt


class SegmentationResponse(BaseModel):
    id: str
    label: str
    confidence: float
    volumeMl: float
    source: Literal["medsam2"]
    box: RoiPrompt
    overlayUrl: Optional[str] = None


class ReportRequest(BaseModel):
    modality: str
    bodyPart: str
    segmentations: list[dict] = Field(default_factory=list)


class ReportResponse(BaseModel):
    summary: str
    findings: str
    impression: str
    recommendation: str
    confidence: float
    source: Literal["medgemma", "qwen-vl"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/llm/status")
def llm_status() -> dict:
    return medgemma_service.status()


@app.post("/studies")
async def create_study(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "uploaded-study"
    is_dicom = filename.lower().endswith(".dcm") or file.content_type == "application/dicom"
    study_id = f"ST-{int(time())}"
    study_dir = STUDIES_DIR / study_id
    study_dir.mkdir(parents=True, exist_ok=True)
    stored_path = study_dir / filename

    with stored_path.open("wb") as output:
        copyfileobj(file.file, output)

    metadata = {}
    preview_url = None
    if is_dicom:
        metadata = render_dicom_preview(stored_path, study_dir)
        preview_url = f"/data/studies/{study_id}/preview.png"

    return {
        "id": study_id,
        "patientName": metadata.get("patientName", "Uploaded Study"),
        "patientDetail": metadata.get("patientDetail", "DICOM metadata pending" if is_dicom else "Local image"),
        "modality": metadata.get("modality", "DICOM" if is_dicom else "IMG"),
        "bodyPart": metadata.get("bodyPart", "Unspecified"),
        "series": metadata.get("series", "Uploaded series"),
        "slices": metadata.get("slices", 1),
        "uploadedFileName": filename,
        "isDicom": is_dicom,
        "previewUrl": preview_url,
    }


@app.get("/sample-studies/pre-liver")
def load_pre_liver_sample() -> dict:
    sample_dir = Path(__file__).resolve().parent.parent / "2.000000-PRE LIVER-76970"
    dicom_files = sorted(sample_dir.glob("*.dcm"))
    if not dicom_files:
        raise FileNotFoundError(f"No DICOM files found in {sample_dir}")

    study_id = f"PRE-LIVER-{int(time())}"
    study_dir = STUDIES_DIR / study_id
    study_dir.mkdir(parents=True, exist_ok=True)
    first_slice = dicom_files[0]
    stored_path = study_dir / first_slice.name
    copy2(first_slice, stored_path)
    metadata = render_dicom_preview(stored_path, study_dir)

    return {
        "id": study_id,
        "patientName": metadata.get("patientName", "PRE LIVER Sample"),
        "patientDetail": metadata.get("patientDetail", "Local sample"),
        "modality": metadata.get("modality", "CT"),
        "bodyPart": metadata.get("bodyPart", "Liver"),
        "series": metadata.get("series", "PRE LIVER"),
        "slices": len(dicom_files),
        "uploadedFileName": sample_dir.name,
        "isDicom": True,
        "previewUrl": f"/data/studies/{study_id}/preview.png",
    }


@app.post("/studies/{study_id}/segmentations/medsam2", response_model=SegmentationResponse)
def segment_with_medsam2(study_id: str, request: SegmentationRequest) -> SegmentationResponse:
    result = medsam2_service.segment(study_id=study_id, prompt=request.prompt)
    result.setdefault("box", request.prompt.model_dump())
    return SegmentationResponse(**result)


@app.post("/studies/{study_id}/reports/medgemma", response_model=ReportResponse)
def report_with_medgemma(study_id: str, request: ReportRequest) -> ReportResponse:
    result = medgemma_service.generate_report(study_id=study_id, request=request)
    return ReportResponse(**result)


@app.post("/studies/{study_id}/reports/qwen-vl", response_model=ReportResponse)
def report_with_qwen_vl(study_id: str, request: ReportRequest) -> ReportResponse:
    try:
        result = medgemma_service.generate_report(study_id=study_id, request=request)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Qwen VL request failed: {exc}") from exc
    return ReportResponse(**result)


def render_dicom_preview(dicom_path: Path, study_dir: Path) -> dict:
    try:
        import numpy as np
        import pydicom
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Install pydicom, numpy, and pillow to render DICOM previews.") from exc

    dataset = pydicom.dcmread(dicom_path)
    pixels = dataset.pixel_array.astype("float32")

    if pixels.ndim > 2:
        pixels = pixels[0]

    slope = float(getattr(dataset, "RescaleSlope", 1))
    intercept = float(getattr(dataset, "RescaleIntercept", 0))
    pixels = pixels * slope + intercept

    center = getattr(dataset, "WindowCenter", None)
    width = getattr(dataset, "WindowWidth", None)
    if isinstance(center, pydicom.multival.MultiValue):
        center = center[0]
    if isinstance(width, pydicom.multival.MultiValue):
        width = width[0]

    if center is not None and width is not None:
        center = float(center)
        width = float(width)
        low = center - width / 2
        high = center + width / 2
    else:
        low, high = np.percentile(pixels, [1, 99])

    pixels = np.clip((pixels - low) / max(high - low, 1), 0, 1)
    image = Image.fromarray((pixels * 255).astype("uint8"), mode="L")
    image.save(study_dir / "preview.png")

    patient_name = str(getattr(dataset, "PatientName", "Uploaded Study")).replace("^", " ")
    patient_id = str(getattr(dataset, "PatientID", "DICOM metadata"))
    modality = str(getattr(dataset, "Modality", "DICOM"))
    body_part = str(getattr(dataset, "BodyPartExamined", "Unspecified")).title()
    series = str(getattr(dataset, "SeriesDescription", "DICOM series"))

    return {
        "patientName": patient_name,
        "patientDetail": patient_id,
        "modality": modality,
        "bodyPart": body_part,
        "series": series,
        "slices": 1,
    }
