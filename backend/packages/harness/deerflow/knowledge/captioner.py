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
import logging
import re
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx

from deerflow.config.app_config import get_app_config
from deerflow.config.rag_config_file import SECRET_ENV_VARS
from deerflow.knowledge.caption_client import request_caption
from deerflow.knowledge.parser import ParsedImage
from deerflow.knowledge.vlm_target import VlmTarget, resolve_vlm_target

logger = logging.getLogger(__name__)

# Env var name can be overridden via config
VL_API_KEY_ENV = SECRET_ENV_VARS["vlm_api_key"]

_CAPTION_PROMPT = "请分析这张图片，用于文档检索索引：如果图片以文字内容为主（如文档截图、表格、代码），请完整转录图中的全部文字；否则请用一句简洁的中文描述图片的主要内容（对象、场景、关键文字）。只输出转录或描述文本，不要多余解释。"

_IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def _placeholder(ref: str) -> str:
    return f"图片 {Path(ref).name}"


async def _caption_one(client: httpx.AsyncClient, image: ParsedImage, *, target: VlmTarget) -> str:
    return await request_caption(client, target=target, prompt=_CAPTION_PROMPT, images=[(image.content, image.media_type)])


async def caption_images(
    images: Sequence[ParsedImage],
    *,
    client: httpx.AsyncClient | None = None,
    model: str | None = None,
) -> dict[str, str]:
    """Caption every image with concurrent calls; failures degrade to filename placeholders.

    The target (model id, endpoint, key) is resolved by :func:`resolve_vlm_target` — naming
    a configured ``models:`` entry supplies all three. A missing key degrades every image to
    its placeholder without any outbound call. *model* overrides ``rag.vlm_model``. Uses
    asyncio.gather with Semaphore(4) for concurrency control; results are returned in input
    list order to protect Markdown image position mapping.
    """
    if not images:
        return {}

    cfg = get_app_config()
    api_key_env = cfg.rag.vlm_api_key_env or VL_API_KEY_ENV
    target = resolve_vlm_target(cfg, model)
    api_key = target.api_key

    if not api_key:
        logger.warning("%s is not set; degrading %d image(s) to filename placeholders", api_key_env, len(images))
        return {image.ref: _placeholder(image.ref) for image in images}

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
                result = await _caption_one(http, img, target=target)
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
