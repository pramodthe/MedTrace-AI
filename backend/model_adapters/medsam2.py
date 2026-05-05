from __future__ import annotations

import importlib
import os
from typing import Any

import httpx


class MedSAM2Service:
    """Connects segmentation routes to MedSAM2.

    Supported modes:
    - MEDSAM2_ENDPOINT=http://... for a separate MedSAM2 inference server.
    - MEDSAM2_ADAPTER_MODULE=your_module with a segment(study_id, prompt) function.
    - no env vars: deterministic mock output so the app still runs.

    MedSAM2 repositories are research-code style rather than one stable pip API,
    so the local path is intentionally adapter based.
    """

    def __init__(self) -> None:
        self.endpoint = os.getenv("MEDSAM2_ENDPOINT")
        self.adapter_module = os.getenv("MEDSAM2_ADAPTER_MODULE")

    def segment(self, study_id: str, prompt: Any) -> dict[str, Any]:
        payload = {
            "study_id": study_id,
            "prompt": {
                "x": prompt.x,
                "y": prompt.y,
                "width": prompt.width,
                "height": prompt.height,
            },
        }

        if self.endpoint:
            return self._segment_http(payload)

        if self.adapter_module:
            return self._segment_adapter(study_id, prompt)

        return self._mock_segmentation(study_id, prompt)

    def _segment_http(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            f"{self.endpoint.rstrip('/')}/segment",
            json=payload,
            timeout=180,
        )
        response.raise_for_status()
        return response.json()

    def _segment_adapter(self, study_id: str, prompt: Any) -> dict[str, Any]:
        module = importlib.import_module(self.adapter_module or "")
        segment = getattr(module, "segment")
        result = segment(study_id=study_id, prompt=prompt)
        if not isinstance(result, dict):
            raise TypeError("MEDSAM2_ADAPTER_MODULE.segment must return a dict")
        return result

    def _mock_segmentation(self, study_id: str, prompt: Any) -> dict[str, Any]:
        return {
            "id": f"seg-{study_id}",
            "label": "Mock prompted ROI",
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
