"""Local MinerU service client (spec 2026-09-14 §4.4 / §8.1).

The local service is MinerU's own FastAPI app (``mineru-api``), driven as a **thin
client** (D2-A): we upload the file over multipart and poll, while the engine choice
(``vlm`` / ``hybrid``) and every model-management concern stay on the service side.

Contract, pinned from upstream source (``mineru/cli/fast_api.py``,
``mineru/cli/api_request.py``, ``mineru/cli/backend_options.py``):

1. ``POST /tasks`` (multipart) → 202 with ``task_id`` and ``file_names``;
2. ``GET /tasks/{id}`` → ``pending`` / ``processing`` / ``completed`` / ``failed``;
3. ``GET /tasks/{id}/result`` → ``{results: {<stem>: {md_content, images}}}``.

Three upstream shapes drive the code here:

- the result key is the **service's** normalized stem, so it is read back from
  ``file_names`` instead of being recomputed from the local path;
- images arrive as data URIs keyed by basename while the markdown references them as
  ``images/<basename>`` — that is the ``ParsedImage.ref`` handed downstream (the
  captioner rewrites alt text by ref and the worker writes the file at that path);
- ``backend`` takes the ``*-engine`` / ``*-http-client`` family, so our short ids gain
  the ``-http-client`` suffix (D2-A puts the other members out of scope).

The service ships without authentication (spec §8.2) — it belongs on an internal
network, so no token is ever sent. Failures reuse the parser's error taxonomy so the
worker's degradation contract stays identical across providers.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
import time
from pathlib import Path

import httpx

from deerflow.knowledge.embedder import RagConfigurationError
from deerflow.knowledge.parser import (
    MineruError,
    MineruParseFailedError,
    MineruTimeoutError,
    ParsedDocument,
    ParsedImage,
    normalize_mineru_markdown,
)

logger = logging.getLogger(__name__)

#: ``rag.parse_backend`` → the service's own backend ids. Only the http-client family is
#: in the support surface (D2-A): the engine variants would mean running models locally.
_BACKEND_FORM_VALUES = {"vlm": "vlm-http-client", "hybrid": "hybrid-http-client"}
#: Non-terminal task statuses (upstream: pending / processing, both non-terminal).
_PENDING_STATUSES = frozenset({"pending", "processing"})
_DATA_URI_RE = re.compile(r"^data:(?P<mime>[^;,]+);base64,(?P<payload>.*)$", re.DOTALL)


def _check_http(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise MineruError(f"本地 MinerU HTTP {response.status_code}: {response.text[:200]}", status=response.status_code)


def _json_object(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise MineruError(f"本地 MinerU 返回了非 JSON 响应：{response.text[:200]}") from exc
    if not isinstance(payload, dict):
        raise MineruError(f"本地 MinerU 返回了非对象 JSON：{payload!r}")
    return payload


def _decode_image(name: str, value: object) -> ParsedImage:
    """One ``images`` entry (a base64 data URI keyed by basename) → ``ParsedImage``."""
    match = _DATA_URI_RE.match(value) if isinstance(value, str) else None
    if match is None:
        raise MineruError(f"本地 MinerU 返回的图片 {name!r} 不是 data URI")
    try:
        content = base64.b64decode(match.group("payload"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MineruError(f"本地 MinerU 返回的图片 {name!r} base64 解码失败") from exc
    return ParsedImage(ref=f"images/{name}", content=content, media_type=match.group("mime"))


def _decode_result(payload: dict, key: str) -> ParsedDocument:
    """Unwrap ``{results: {<stem>: {md_content, images}}}`` for the uploaded file."""
    results = payload.get("results") or {}
    entry = results.get(key)
    if not isinstance(entry, dict):
        raise MineruError(f"本地 MinerU 结果里没有 {key!r}（实际键：{sorted(results)}）")
    markdown = entry.get("md_content")
    if not isinstance(markdown, str):
        raise MineruError(f"本地 MinerU 结果缺少 md_content（{key}）")
    images = [_decode_image(name, value) for name, value in (entry.get("images") or {}).items()]
    return ParsedDocument(markdown=markdown, images=images)


class MineruLocalParseProvider:
    """``ParseProvider`` for a self-hosted MinerU service (multipart submit + poll)."""

    def __init__(
        self,
        *,
        base_url: str | None,
        backend: str | None = None,
        client: httpx.AsyncClient | None = None,
        poll_interval_seconds: float = 5.0,
        timeout_seconds: float = 1800.0,
    ) -> None:
        if not (base_url or "").strip():
            raise RagConfigurationError("本地解析需要服务地址：请设置 rag.parse_base_url（parse_provider=mineru-local）")
        if backend is not None and backend not in _BACKEND_FORM_VALUES:
            raise RagConfigurationError(f"未知的 parse_backend {backend!r}；可选 {sorted(_BACKEND_FORM_VALUES)}")
        self._base_url = base_url.strip().rstrip("/")
        # 空 = 由服务端决定（D4-B）：不下发 backend 字段，我们不管 MinerU 的档位
        self._backend = _BACKEND_FORM_VALUES[backend] if backend else None
        self._client = client
        self._poll_interval_seconds = poll_interval_seconds
        self._timeout_seconds = timeout_seconds

    async def parse(self, file_path: str | Path) -> ParsedDocument:
        path = Path(file_path)
        own_client = self._client is None
        http = self._client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0))
        try:
            task_id, key = await self._submit(http, path)
            await self._await_terminal(http, task_id)
            parsed = _decode_result(await self._request(http, "GET", f"{self._base_url}/tasks/{task_id}/result"), key)
            return ParsedDocument(markdown=normalize_mineru_markdown(parsed.markdown), images=parsed.images)
        finally:
            if own_client:
                await http.aclose()

    async def _request(self, http: httpx.AsyncClient, method: str, url: str, **kwargs) -> dict:
        """One call to the local service: transport failures become ``MineruError``."""
        try:
            response = await http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise MineruError(f"本地 MinerU 服务不可达（{url}）：{exc}") from exc
        _check_http(response)
        return _json_object(response)

    async def _submit(self, http: httpx.AsyncClient, path: Path) -> tuple[str, str]:
        data = {"lang_list": "ch", "return_md": "true", "return_images": "true"}
        if self._backend is not None:
            data["backend"] = self._backend
        payload = await self._request(
            http,
            "POST",
            f"{self._base_url}/tasks",
            data=data,
            files={"files": (path.name, path.read_bytes())},
        )
        task_id = payload.get("task_id")
        if not task_id:
            raise MineruError(f"本地 MinerU 未返回 task_id：{payload!r}")
        # 结果键是服务端归一化后的 stem；用 file_names 而不是本地路径拼（两者可能不同）
        key = (payload.get("file_names") or [path.stem])[0]
        return str(task_id), str(key)

    async def _await_terminal(self, http: httpx.AsyncClient, task_id: str) -> None:
        deadline = time.monotonic() + self._timeout_seconds
        while True:
            payload = await self._request(http, "GET", f"{self._base_url}/tasks/{task_id}")
            status = payload.get("status")
            if status == "completed":
                return
            if status == "failed":
                raise MineruParseFailedError(payload.get("error") or "本地 MinerU 解析失败")
            if status not in _PENDING_STATUSES:
                logger.warning("Unknown local MinerU task status %r; continuing to poll", status)
            if time.monotonic() >= deadline:
                raise MineruTimeoutError(f"本地 MinerU 解析超时（{self._timeout_seconds:.0f}s，task {task_id}）")
            await asyncio.sleep(self._poll_interval_seconds)
