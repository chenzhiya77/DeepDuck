"""VLM image captioning for parsed documents (spec §3.1, Task 15 dual-mode).

Each image extracted by the parser gets a Chinese caption from the SiliconFlow
VLM (Qwen3-VL), written back into the markdown as ``![caption](ref)`` alt text
*before* chunking, so image content becomes searchable text. The prompt is
dual-mode (Task 15): text-dense images (document screenshots, tables, code)
are transcribed in full — matching the depth standalone image uploads get from
MinerU OCR — while other images get a one-sentence summary. Captioning is an
enhancement, never a hard dependency: a VLM failure (or a missing key)
degrades that image to a filename placeholder without aborting the document.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx

from deerflow.knowledge.parser import ParsedImage

logger = logging.getLogger(__name__)

SILICONFLOW_CHAT_URL = "https://api.siliconflow.cn/v1/chat/completions"
_KEY_ENV_VAR = "SILICONFLOW_VLM_API_KEY"

_CAPTION_PROMPT = (
    "请分析这张图片，用于文档检索索引：如果图片以文字内容为主（如文档截图、表格、代码），请完整转录图中的全部文字，保留原有结构；否则请用一句简洁的中文描述图片的主要内容（对象、场景、关键文字）。只输出转录或描述文本，不要多余解释。"
)

_IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def _placeholder(ref: str) -> str:
    return f"图片 {Path(ref).name}"


async def _caption_one(client: httpx.AsyncClient, image: ParsedImage, *, model: str, api_key: str) -> str:
    image_b64 = base64.b64encode(image.content).decode("ascii")
    response = await client.post(
        SILICONFLOW_CHAT_URL,
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
            "temperature": 0.2,
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
    """Caption every image; failures degrade to a filename placeholder.

    The key comes from ``SILICONFLOW_VLM_API_KEY``; when unset, every image
    degrades to its placeholder without any outbound call. *model* defaults
    to ``rag.vlm_model`` from the app config.
    """
    if not images:
        return {}
    api_key = os.environ.get(_KEY_ENV_VAR)
    if not api_key:
        logger.warning("%s is not set; degrading %d image(s) to filename placeholders", _KEY_ENV_VAR, len(images))
        return {image.ref: _placeholder(image.ref) for image in images}
    if model is None:
        from deerflow.config.app_config import get_app_config

        model = get_app_config().rag.vlm_model

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))
    captions: dict[str, str] = {}
    try:
        for image in images:
            try:
                captions[image.ref] = await _caption_one(http, image, model=model, api_key=api_key)
            except Exception as exc:  # degrade, never abort the document
                logger.warning("VLM caption failed for %s (%s); using filename placeholder", image.ref, exc)
                captions[image.ref] = _placeholder(image.ref)
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
