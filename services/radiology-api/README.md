# Med Backend Contract

This backend is the thin service layer the React app expects. It keeps heavy medical imaging and AI work out of the browser.

## Intended Pipeline

1. Upload DICOM or image study with `POST /studies`.
2. Convert DICOM into viewer-friendly metadata and preview frames.
3. Run MedSAM2 from a clinician prompt with `POST /studies/{study_id}/segmentations/medsam2`.
4. Run MedGemma with image context, segmentation metadata, and optional clinical text using `POST /studies/{study_id}/reports/medgemma`.
5. Return draft findings only. The UI requires explicit doctor acceptance.

## Endpoints

### `POST /studies`

Multipart upload field: `file`

Returns:

```json
{
  "id": "ST-...",
  "patientName": "Uploaded Study",
  "patientDetail": "DICOM metadata",
  "modality": "CT",
  "bodyPart": "Chest",
  "series": "Series 1",
  "slices": 128,
  "isDicom": true,
  "previewUrl": "/studies/ST-.../frames/0.png"
}
```

### `POST /studies/{study_id}/segmentations/medsam2`

Body:

```json
{
  "prompt": {
    "x": 0.47,
    "y": 0.34,
    "width": 0.16,
    "height": 0.22
  }
}
```

Returns:

```json
{
  "id": "seg-...",
  "label": "Prompted ROI",
  "confidence": 0.86,
  "volumeMl": 12.4,
  "source": "medsam2",
  "box": { "x": 0.47, "y": 0.34, "width": 0.16, "height": 0.22 }
}
```

### `POST /studies/{study_id}/reports/medgemma`

The app currently calls the Qwen VL alias:

### `POST /studies/{study_id}/reports/qwen-vl`

Body:

```json
{
  "modality": "CT",
  "bodyPart": "Chest",
  "segmentations": []
}
```

Returns:

```json
{
  "summary": "Draft AI assessment",
  "findings": "Findings text...",
  "impression": "Impression text...",
  "recommendation": "Clinical correlation and doctor review required.",
  "confidence": 0.82,
  "source": "medgemma"
}
```

## Implementation Notes

- DICOM parsing/rendering should be done server-side first with `pydicom` plus `highdicom`/`SimpleITK` as needed. A full browser renderer can be added later with Cornerstone3D.
- MedSAM2 should receive normalized clinician prompts plus the current slice/series context, then return masks in image coordinates and any volume/area measurements.
- MedGemma should be treated as draft clinical decision support. Google’s model card says validation and adaptation are required before production clinical use.
- Store studies locally at first. Add Orthanc/DICOMweb only after local upload is reliable.

## How The Models Connect

The FastAPI routes call adapter classes in `backend/model_adapters/`.

### Temporary Qwen VL reporting through Nebius

For now, the easiest image-report path is Qwen2.5-VL through the Nebius OpenAI-compatible API.

```bash
export NEBIUS_API_KEY="your_nebius_key"
export NEBIUS_BASE_URL="https://api.tokenfactory.nebius.com/v1"
export NEBIUS_QWEN_VL_MODEL="Qwen/Qwen2.5-VL-72B-Instruct"
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

When `NEBIUS_API_KEY` is set, `POST /studies/{study_id}/reports/qwen-vl` sends:

- the rendered `preview.png` for that study as an image input
- modality/body part metadata
- segmentation ROI metadata from the frontend

The response is normalized into:

```json
{
  "summary": "Qwen VL draft assessment",
  "findings": "Draft findings...",
  "impression": "Draft impression...",
  "recommendation": "Doctor verification required.",
  "confidence": 0.5,
  "source": "qwen-vl"
}
```

This is draft decision support only. It must not be treated as a final diagnosis.

### Start the API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

The frontend already calls `http://127.0.0.1:8000` by default. You can override that with `VITE_API_BASE_URL`.

### Option A: connect separate model servers

This is the best production shape because MedSAM2 and MedGemma may need different Python/CUDA environments.

```bash
export MEDSAM2_ENDPOINT="http://127.0.0.1:8011"
export MEDGEMMA_ENDPOINT="http://127.0.0.1:8012"
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

The MedSAM2 server must implement:

```http
POST /segment
```

Request:

```json
{
  "study_id": "ST-123",
  "prompt": { "x": 0.47, "y": 0.34, "width": 0.16, "height": 0.22 }
}
```

Response:

```json
{
  "id": "seg-ST-123",
  "label": "Prompted MedSAM2 ROI",
  "confidence": 0.86,
  "volumeMl": 12.4,
  "source": "medsam2"
}
```

The MedGemma server must implement:

```http
POST /generate-report
```

Request:

```json
{
  "study_id": "ST-123",
  "modality": "CT",
  "body_part": "Chest",
  "segmentations": []
}
```

Response:

```json
{
  "summary": "MedGemma draft assessment",
  "findings": "Findings...",
  "impression": "Impression...",
  "recommendation": "Doctor review required.",
  "confidence": 0.78,
  "source": "medgemma"
}
```

### Option B: run MedGemma locally in this API

Install local inference dependencies:

```bash
pip install torch transformers accelerate
```

Then set the model id:

```bash
export MEDGEMMA_MODEL_ID="google/medgemma-4b-it"
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

You may need Hugging Face access/token depending on the model license flow:

```bash
export HF_TOKEN="..."
```

### Option C: run MedSAM2 through a local adapter module

MedSAM2 repos are research-code style and do not expose one universal pip API. For local use, create a module on `PYTHONPATH` with:

```python
def segment(study_id, prompt):
    # Load study volume/slice.
    # Convert normalized prompt into pixel box.
    # Run MedSAM2 predictor.
    # Save mask and return measurements.
    return {
        "id": f"seg-{study_id}",
        "label": "Prompted MedSAM2 ROI",
        "confidence": 0.86,
        "volumeMl": 12.4,
        "source": "medsam2",
        "box": {
            "x": prompt.x,
            "y": prompt.y,
            "width": prompt.width,
            "height": prompt.height,
        },
    }
```

Then:

```bash
export MEDSAM2_ADAPTER_MODULE="your_medsam2_adapter"
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

No env vars means the backend returns mock outputs, which is useful for developing the UI without GPU/model setup.

## MCP Integration (Skybridge app)

This backend is now also consumed by the Skybridge MCP app at `../mcp-app`.

The MCP server maps these tools to backend routes:

- `get-health-status` -> `GET /health`
- `get-llm-status` -> `GET /llm/status`
- `upload-study` -> `POST /studies`
- `load-sample-study` -> `GET /sample-studies/pre-liver`
- `run-medsam2-segmentation` -> `POST /studies/{study_id}/segmentations/medsam2`
- `generate-qwen-report` -> `POST /studies/{study_id}/reports/qwen-vl`
- `generate-medgemma-report` -> `POST /studies/{study_id}/reports/medgemma`

The MCP app adds a view tool named `open-med-workspace` that keeps state for studies, ROI, segmentation/report results, and doctor review decisions.

### Requirement notes

- `python-multipart` is required for `POST /studies` form uploads.
- `pydicom>=2.4.4` is used for broad pip compatibility in local environments.
