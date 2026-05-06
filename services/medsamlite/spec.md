# Doctor Assist Workflow Spec

## Goal

Implement the target workflow:

1. Doctor looks at image.
2. Doctor draws a box around suspicious region (or clicks points).
3. Swin_LiteMedSAM generates a mask overlay for that region.
4. MedGemma provides narrative review and suggestions (before or after segmentation).

This repo currently implements step 1-3 (box-to-mask). Step 4 is defined here as the next integration phase.

## Product Scope

### Phase 1 (Implemented Now)

- Browser upload of 2D image (PNG/JPG/JPEG).
- Manual drag-box selection.
- Swin_LiteMedSAM overlay generation.
- FastAPI backend + basic frontend.

### Phase 2 (Planned)

- MedGemma narrative/suggestion service connected to same image and ROI.
- Side panel showing model narrative with structured sections:
  - Findings
  - Confidence/uncertainty language
  - Suggested follow-up actions

### Not in Scope (Current)

- Autonomous diagnosis.
- 3D/volume workflow.
- Native DICOM study viewer.
- Regulatory/clinical deployment controls.

## Workflow Definition

### Primary User Journey

1. Doctor uploads image.
2. Doctor draws ROI box.
3. System returns segmentation overlay for ROI.
4. Doctor requests/receives MedGemma narrative.
5. Doctor decides next action.

### Interaction Contract

- Segmentation is **prompted by doctor ROI** (box/points), not by free-text diagnosis command.
- MedGemma narrative is **decision support text**, not a final diagnosis.
- Narrative must reference visible ROI context when available.

## Architecture

### Current Architecture (Phase 1)

- `web/index.html`: drag-box frontend.
- `app_basic.py`: API server.
- `swin_demo/inference_core.py`: model loading + inference.
- `third_party/Swin_LiteMedSAM/*`: required model modules.
- `Swin_LiteMedSam/Swin_LiteMedSAM.pth`: checkpoint.

### Target Architecture (Phase 2)

- Keep segmentation API as-is (`/segment`).
- Add narrative endpoint (`/narrative`) backed by MedGemma-compatible provider.
- UI calls:
  - `/segment` after box selection.
  - `/narrative` after segmentation (or on-demand).

## API Plan

### Existing Endpoint

- `POST /segment`
  - Inputs: image file + `x_min`, `y_min`, `x_max`, `y_max`
  - Output: PNG overlay

### Planned Endpoint

- `POST /narrative`
  - Inputs:
    - image (or image id)
    - ROI coordinates
    - optional overlay/mask reference
    - optional prompt context
  - Output (JSON):
    - `summary`
    - `findings[]`
    - `suggestions[]`
    - `disclaimer`

## Safety and Clinical Positioning

- Output is assistive and must be reviewed by a clinician.
- Avoid deterministic language like "confirmed diagnosis."
- Include clear uncertainty/disclaimer in narrative output.
- Keep segmentation and narrative visually linked to reduce ambiguity.

## Runtime Requirements

- Python 3.9+
- Dependencies in `pyproject.toml`
- Optional GPU (`cuda`) for faster response
- CPU fallback supported

## Run (Current Phase)

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -e .
python app_basic.py --device auto --host 127.0.0.1 --port 7870
```

Open: `http://127.0.0.1:7870`

## Acceptance Criteria

### Phase 1 Done When

- Doctor can upload image, draw box, and get overlay reliably.
- Box interaction works without Gradio-specific issues.
- API returns meaningful errors for invalid input.

### Phase 2 Done When

- Narrative endpoint returns structured response.
- UI displays segmentation + narrative together.
- Narrative explicitly framed as recommendation, not diagnosis.

