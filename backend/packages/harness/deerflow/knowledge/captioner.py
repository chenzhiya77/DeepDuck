"""VLM image captioning for parsed documents (spec §3.1, Task 15 dual-mode).

Each image extracted by the parser gets a Chinese caption from the DashScope
VLM (qwen3.7-flash), written back into the markdown as ``![caption](ref)`` alt text
*before* chunking, so image content becomes searchable text. The prompt is
dual-mode (Task 15): text-dense images (document screenshots, tables, code)
are transcribed in full — matching the depth standalone image uploads get from
MinerU OCR — while other images get a one-sentence summary. Captioning is an
enhancement, never a hard dependency: a VLM failure (or a missing key)
degrades that image to a filename placeholder without aborting the document.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx

from deerflow.config.app_config import get_app_config
from deerflow.knowledge.parser import ParsedImage

logger = logging.getLogger(__name__)

# OpenAI-compatible endpoint for qwen3.7-flash on DashScope
VL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
# Env var name can be overridden via config
VL_API_KEY_ENV = "DASHSCOPE_API_KEY"

_CAPTION_PROMPT = "请分析这张图片，用于文档检索索引：如果图片以文字内容为主（如文档截图、表格、代码），请完整转录图中的全部文字；否则请用一句简洁的中文描述图片的主要内容（对象、场景、关键文字）。只输出转录或描述文本，不要多余解释。"

_IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def _placeholder(ref: str) -> str:
    return f"图片 {Path(ref).name}"


async def _caption_one(client: httpx.AsyncClient, image: ParsedImage, *, model: str, api_key: str) -> str:
    image_b64 = base64.b64encode(image.content).decode("ascii")
    response = await client.post(
        VL_BASE_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{image.media_type};base64,{image_b64}"}},
                        {"type": "text", "text": _CAPTION_PROMPT},
                    ],
                }
            ],
            "max_tokens": 1024,  # Task 15: room for full-page transcription
            "temperature": 0.15,  # Task 16: slightly lower for more stable OCR
        },
    )
    response.raise_for_status()
    payload = response.json()
    caption = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not caption:
        raise ValueError(f"VLM returned an empty caption for {image.ref}")
    return caption


async def caption_images(
    images: Sequence[ParsedImage],
    *,
    client: httpx.AsyncClient | None = None,
    model: str | None = None,
) -> dict[str, str]:
    """Caption every image with concurrent calls; failures degrade to filename placeholders.

    The key comes from ``DASHSCOPE_API_KEY`` env var (configurable via app config);
    when unset, every image degrades to its placeholder without any outbound call.
    *model* defaults to ``rag.vlm_model`` from the app config. Uses asyncio.gather
    with Semaphore(4) for concurrency control; results are returned in input list order
    to protect Markdown image position mapping.
    """
    if not images:
        return {}

    # Get config dynamically
    cfg = get_app_config()
    api_key_env = cfg.rag.vlm_api_key_env or VL_API_KEY_ENV
    api_key = os.environ.get(api_key_env)

    if not api_key:
        logger.warning("%s is not set; degrading %d image(s) to filename placeholders", api_key_env, len(images))
        return {image.ref: _placeholder(image.ref) for image in images}

    if model is None:
        model = cfg.rag.vlm_model

    own_client = client is None
    # Task 16: timeout raised to 180s for long-form transcription
    timeout = httpx.Timeout(cfg.rag.vlm_timeout or 180.0, connect=cfg.rag.vlm_connect_timeout or 15.0)
    http = client or httpx.AsyncClient(timeout=timeout)

    # Task 16: concurrent execution with semaphore-limited parallelism
    captions: dict[str, str] = {}
    semaphore = asyncio.Semaphore(4)  # max 4 concurrent requests

    async def caption_with_semaphore(img: ParsedImage) -> tuple[str, str]:
        async with semaphore:
            try:
                result = await _caption_one(http, img, model=model, api_key=api_key)
                return img.ref, result
            except Exception as exc:
                logger.warning("VLM caption failed for %s (%s); using filename placeholder", img.ref, exc)
                return img.ref, _placeholder(img.ref)

    try:
        # Run all captions concurrently and preserve original list order
        tasks = [caption_with_semaphore(img) for img in images]
        results = await asyncio.gather(*tasks)
        # zip ensures results follow input list order, never mixed up
        captions.update(results)
    finally:
        if own_client:
            await http.aclose()
    return captions


def apply_captions(markdown: str, captions: Mapping[str, str]) -> str:
    """Rewrite ``![alt](ref)`` alt text with captions for known refs."""

    def _sub(match: re.Match[str]) -> str:
        ref = match.group(1)
        caption = captions.get(ref)
        if caption is None:
            return match.group(0)
        return f"![{caption}]({ref})"

    return _IMAGE_REF_RE.sub(_sub, markdown)
