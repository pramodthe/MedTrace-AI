"""Fireworks AI OpenAI-compatible API (chat + vision) for LangChain ``ChatOpenAI``."""

from __future__ import annotations

import os

DEFAULT_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1/"
# Serverless text model — entitlement varies by API key; Llama 3.3 70B is commonly enabled when DeepSeek ids are not.
DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/llama-v3p3-70b-instruct"
# Multimodal default for PDF page ingest (must accept images). Not every account has Qwen3.6 Plus.
DEFAULT_FIREWORKS_VL_MODEL = "accounts/fireworks/models/kimi-k2p5"


def _env_model(var: str) -> str:
    """Trim whitespace and surrounding quotes from ``FIREWORKS_*`` model env vars."""
    return (os.environ.get(var) or "").strip().strip('"').strip("'")


def fireworks_base_url() -> str:
    raw = (os.environ.get("FIREWORKS_BASE_URL") or DEFAULT_FIREWORKS_BASE_URL).strip()
    return raw if raw.endswith("/") else raw + "/"


def fireworks_api_key() -> str:
    key = (os.environ.get("FIREWORKS_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("FIREWORKS_API_KEY is not set.")
    return key


def fireworks_chat_model() -> str:
    m = _env_model("FIREWORKS_MODEL")
    return m or DEFAULT_FIREWORKS_MODEL


def fireworks_vlm_model() -> str:
    """Multimodal model id for PDF vision ingest (never falls back to a text-only chat model)."""
    m = _env_model("FIREWORKS_VL_MODEL")
    return m or DEFAULT_FIREWORKS_VL_MODEL


def fireworks_vlm_api_mode() -> str:
    """
    How PDF page vision calls Fireworks:

    - ``completions`` — ``POST /v1/completions`` with ``prompt`` containing ``<image>`` and top-level
      ``images`` (URLs or ``data:image/...;base64,...``). Matches Fireworks Qwen VL examples.
    - ``chat`` — LangChain ``ChatOpenAI`` + ``/v1/chat/completions`` (OpenAI-style message content).

    See https://docs.fireworks.ai/guides/querying-vision-language-models (Completions API section).
    """
    # Default chat-completions path works with OpenAI-style vision (e.g. kimi-k2p5). Use completions for
    # Fireworks Qwen-style ``<image>`` prompt templates when your VL model supports it.
    v = (os.environ.get("FIREWORKS_VLM_API") or "chat").strip().lower()
    return v if v in ("chat", "completions") else "chat"


def fireworks_reasoning_effort() -> str:
    """
    Fireworks Qwen3 models emit chain-of-thought into ``reasoning_content`` by default, leaving
    ``content`` empty unless the completion budget is large. ``none`` keeps JSON/text in
    ``content`` (required for VLM page extract and LangChain message parsing).
    Override with FIREWORKS_REASONING_EFFORT (e.g. ``medium``) if you want visible CoT.
    """
    v = (os.environ.get("FIREWORKS_REASONING_EFFORT") or "none").strip().lower()
    return v if v else "none"
