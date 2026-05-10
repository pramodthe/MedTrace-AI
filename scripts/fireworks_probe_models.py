#!/usr/bin/env python3
"""Print HTTP status for common Fireworks serverless chat models (reads repo ``.env``)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]


def main() -> None:
    try:
        import httpx
        from dotenv import load_dotenv
    except ImportError as exc:
        print(f"Missing dependency: {exc}", file=sys.stderr)
        sys.exit(1)

    load_dotenv(_REPO / ".env", override=True)
    load_dotenv(_REPO / ".env.local", override=True)

    key = (os.environ.get("FIREWORKS_API_KEY") or "").strip()
    raw_base = (os.environ.get("FIREWORKS_BASE_URL") or "https://api.fireworks.ai/inference/v1/").strip()
    base = raw_base.rstrip("/")
    if not key:
        print("Set FIREWORKS_API_KEY in .env", file=sys.stderr)
        sys.exit(1)

    candidates = [
        "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "accounts/fireworks/models/deepseek-v3p1",
        "accounts/fireworks/models/kimi-k2p5",
        "accounts/fireworks/models/qwen3p6-plus",
        "accounts/fireworks/models/qwen3-235b-a22b",
        "accounts/fireworks/models/qwen3-32b",
        "accounts/fireworks/models/qwen2p5-vl-72b-instruct",
        "accounts/fireworks/models/qwen2p5-vl-32b-instruct",
        "accounts/fireworks/models/qwen2p5-vl-7b-instruct",
        "accounts/fireworks/models/mixtral-8x7b-instruct",
        "accounts/fireworks/models/mixtral-8x22b-instruct",
        "accounts/fireworks/models/llama-v3p1-70b-instruct",
        "accounts/fireworks/models/llama-v3p1-8b-instruct",
    ]

    url = f"{base}/chat/completions"
    body_base = {
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 4,
        "reasoning_effort": "none",
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    print(f"POST {url}\n")
    ok_models: list[str] = []
    with httpx.Client(timeout=25.0) as client:
        for model in candidates:
            payload = {"model": model, **body_base}
            try:
                r = client.post(url, headers=headers, json=payload)
            except httpx.RequestError as exc:
                print(f"ERR\t{model}\t{exc}")
                continue
            try:
                data = r.json()
            except json.JSONDecodeError:
                print(f"{r.status_code}\t{model}\t(non-JSON body)")
                continue
            err = data.get("error") if isinstance(data, dict) else None
            msg = ""
            if isinstance(err, dict):
                msg = str(err.get("message") or err.get("type") or "")
            line = f"{r.status_code}\t{model}"
            if msg:
                line += f"\t{msg}"
            print(line)
            if r.status_code == 200:
                ok_models.append(model)

    if ok_models:
        print("\nHTTP 200 (chat) examples you can set as FIREWORKS_MODEL:")
        for m in ok_models[:8]:
            print(f"  {m}")


if __name__ == "__main__":
    main()
