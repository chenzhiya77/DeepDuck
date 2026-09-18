"""The one outbound entry point for both caption legs.

These legs are hand-written HTTP rather than LangChain models, so the protocol is ours to
speak — and it follows the entry's provider, not a setting of its own (`VlmTarget.dialect`).
Two dialects today: the OpenAI shape (`POST {base}/chat/completions`, `Authorization`) and
Anthropic's Messages shape (`POST {base}/v1/messages`, `X-Api-Key`, `anthropic-version`).

Both legs call :func:`request_caption` so each shape is written once; the prompts and the
degradation semantics stay with the legs themselves.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from typing import Literal

import httpx

from deerflow.knowledge.vlm_target import VlmTarget

#: Sent on every Messages request. The SDK's own default value (`anthropic/_client.py:180`);
#: a module constant on purpose — bumping it is a code change, not a config knob.
ANTHROPIC_VERSION = "2023-06-01"

#: Output cap shared by both dialects (Task 15: room for a full-page transcription).
_MAX_TOKENS = 1024

#: Low temperature keeps OCR-style transcriptions stable (Task 16).
_TEMPERATURE = 0.15

Dialect = Literal["openai", "anthropic"]


def _url(target: VlmTarget) -> str:
    base = target.base_url.rstrip("/")
    return f"{base}/v1/messages" if target.dialect == "anthropic" else f"{base}/chat/completions"


def _data_url(data: bytes, media_type: str) -> str:
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


def _openai_request(target: VlmTarget, prompt: str, images: Sequence[tuple[bytes, str]]) -> tuple[dict, dict]:
    content = [{"type": "image_url", "image_url": {"url": _data_url(data, media_type)}} for data, media_type in images]
    content.append({"type": "text", "text": prompt})
    body = {"model": target.model, "messages": [{"role": "user", "content": content}], "max_tokens": _MAX_TOKENS, "temperature": _TEMPERATURE}
    headers = {"Authorization": f"Bearer {target.api_key or ''}", "Content-Type": "application/json"}
    return body, headers


def _anthropic_request(target: VlmTarget, prompt: str, images: Sequence[tuple[bytes, str]]) -> tuple[dict, dict]:
    content = [{"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode("ascii")}} for data, media_type in images]
    content.append({"type": "text", "text": prompt})
    # `max_tokens` is required by the Messages API; the value is the OpenAI leg's own.
    body = {"model": target.model, "max_tokens": _MAX_TOKENS, "messages": [{"role": "user", "content": content}], "temperature": _TEMPERATURE}
    headers = {"X-Api-Key": target.api_key or "", "anthropic-version": ANTHROPIC_VERSION, "Content-Type": "application/json"}
    return body, headers


def _openai_caption(payload: dict) -> str:
    return (payload.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def _anthropic_caption(payload: dict) -> str:
    """Concatenate every text block; a reply may interleave other kinds (e.g. thinking)."""
    return "".join(block.get("text", "") for block in payload.get("content") or [] if block.get("type") == "text").strip()


async def request_caption(
    client: httpx.AsyncClient,
    *,
    target: VlmTarget,
    prompt: str,
    images: Sequence[tuple[bytes, str]],
) -> str:
    """Ask ``target`` to caption ``images`` and return the text, or raise.

    The three ways this can fail are the caller's to interpret: a non-2xx (``raise_for_status``),
    an empty answer, and any transport error. Both legs degrade on all three.
    """
    anthropic = target.dialect == "anthropic"
    body, headers = _anthropic_request(target, prompt, images) if anthropic else _openai_request(target, prompt, images)

    response = await client.post(_url(target), headers=headers, json=body)
    response.raise_for_status()
    caption = _anthropic_caption(response.json()) if anthropic else _openai_caption(response.json())
    if not caption:
        raise ValueError("VLM returned an empty caption")
    return caption
