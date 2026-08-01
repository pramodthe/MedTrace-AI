#!/usr/bin/env python3
from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from swin_demo.inference_core import build_model, predict_mask_from_box

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_CKPT = REPO_ROOT / "Swin_LiteMedSam" / "Swin_LiteMedSAM.pth"


def pick_device(name: str) -> torch.device:
    if name == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    if name == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def make_app(model, device: torch.device) -> FastAPI:
    app = FastAPI(title="Swin-LiteMedSAM basic frontend")
    app.mount("/web", StaticFiles(directory=str(REPO_ROOT / "web")), name="web")

    @app.get("/")
    def root():
        return FileResponse(str(REPO_ROOT / "web" / "index.html"))

    @app.post("/segment")
    async def segment(
        file: UploadFile = File(...),
        x_min: float = Form(...),
        y_min: float = Form(...),
        x_max: float = Form(...),
        y_max: float = Form(...),
    ):
        try:
            data = await file.read()
            pil = Image.open(BytesIO(data)).convert("RGB")
            img = np.array(pil)
            _, overlay = predict_mask_from_box(
                model,
                img,
                (x_min, y_min, x_max, y_max),
                device,
            )
            out = BytesIO()
            Image.fromarray(overlay).save(out, format="PNG")
            out.seek(0)
            return StreamingResponse(out, media_type="image/png")
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CKPT)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7870)
    args = parser.parse_args()

    if not args.checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {args.checkpoint}")

    if args.device == "auto":
        if torch.cuda.is_available():
            device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            device = torch.device("mps")
        else:
            device = torch.device("cpu")
    else:
        device = pick_device(args.device)

    model = build_model(args.checkpoint, device)
    app = make_app(model, device)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
