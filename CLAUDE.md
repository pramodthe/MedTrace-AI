# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo containing a **radiology AI workflow dashboard** with a React frontend and FastAPI backend. The system uploads DICOM studies, runs MedSAM2 segmentation on user-selected ROIs, and generates draft radiology reports via Qwen VL (Nebius API) or MedGemma.

## Architecture

```
frontend/          React 19 + Vite + TypeScript + TailwindCSS + Lucide
backend/            FastAPI Python API
├── app.py          Main routes and CORS config
├── model_adapters/ AI model service wrappers
│   ├── medsam2.py  Segmentation (MedSAM2Service)
│   └── medgemma.py Report generation (MedGemmaService + Qwen VL)
└── data/studies/   Uploaded DICOM/images stored here
```

### Frontend Structure

- **Single-file SPA**: All components defined in `frontend/src/App.tsx` (StudyPanel, ViewerWorkspace, DecisionPanel, FeedbackModal, overlays)
- **Three-panel layout**: Study list (left) | Image viewer with ROI drawing (center) | Report & review (right)
- **ROI coordinate system**: Normalized 0-1 values; converted to pixel coordinates by the backend
- **API base URL**: `http://127.0.0.1:8000` by default; override with `VITE_API_BASE_URL`

### Backend Model Adapters

Both `MedSAM2Service` and `MedGemmaService` support three modes (checked in order):

1. **HTTP endpoint** — `MEDSAM2_ENDPOINT` / `MEDGEMMA_ENDPOINT` for separate model servers
2. **Local adapter module** — `MEDSAM2_ADAPTER_MODULE` / `MEDGEMMA_MODEL_ID` for in-process inference
3. **Mock output** — when no env vars set; app runs with deterministic fake responses

## Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Development server
npm run build         # Production build
```

### Environment Variables

**Backend** (`backend/.env`):
- `NEBIUS_API_KEY` — enables Qwen VL reporting (without this, runs in mock mode)
- `NEBIUS_BASE_URL` — default `https://api.tokenfactory.nebius.com/v1`
- `NEBIUS_QWEN_VL_MODEL` — default `Qwen/Qwen2.5-VL-72B-Instruct`
- `MEDSAM2_ENDPOINT` — separate segmentation model server
- `MEDGEMMA_ENDPOINT` — separate report model server
- `MEDGEMMA_MODEL_ID` — Hugging Face model for local MedGemma inference

**Frontend**: `VITE_API_BASE_URL` to override the backend URL (default `http://127.0.0.1:8000`)

## Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/llm/status` | LLM provider and config status |
| POST | `/studies` | Upload DICOM or image study |
| POST | `/studies/{id}/segmentations/medsam2` | Run segmentation on ROI prompt |
| POST | `/studies/{id}/reports/qwen-vl` | Generate draft radiology report |

## DICOM Handling

- DICOM files are read server-side with `pydicom`
- Pixel values are rescaled using `RescaleSlope`/`RescaleIntercept` and windowed using `WindowCenter`/`WindowWidth`
- Preview PNG is generated at `backend/data/studies/{study_id}/preview.png` and served statically at `/data/studies/`
- Studies without DICOM (local images) use `URL.createObjectURL` on the frontend

## Important Notes

- ROI prompts are normalized (0-1 range) and should be drawn on the image viewport; backend converts to pixel coordinates
- Report generation requires explicit doctor acceptance — the UI enforces this workflow
- `backend/data/studies/` is gitignored; it contains all uploaded patient data
- When `NEBIUS_API_KEY` is not set, the system runs in mock mode with deterministic fake outputs
