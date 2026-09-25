"""Generic OpenAI-compatible embedding client (spec 2026-09-14 §4.2).

The dense-only counterpart of ``DashScopeEmbedder``: any endpoint that speaks the OpenAI
embeddings shape can be plugged in. It never returns a sparse half — the sparse route is
supplied by the composition layer (``external`` service or local BM25), which is exactly
why pairing this provider with ``embedding_sparse_source=provider`` is refused at build
time (spec §4.2 交叉校验).

Contract (standard OpenAI shape):

- ``POST {base_url}/v1/embeddings`` with ``{"model", "input": [...]}``
- response ``{"data": [{"index", "embedding": [...]}, ...]}`` — read back **by index**,
  because providers are not required to preserve request order
- no ``dimensions`` parameter is sent: the endpoint's model decides the width and our
  probe measures it (spec §4.2 维度 #1: 探测为主, 显式字段只作覆盖)

Failures reuse the shared ``EmbedderError`` / ``EmbedderAuthError`` so the worker's
"one bad batch never aborts the document" contract behaves identically across providers.
The key's environment fallback comes from the curated allowlist, so the name this client
reads and the name the settings API reports cannot drift.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Sequence

import httpx
from qdrant_client.models import SparseVector

from deerflow.knowledge.embedder import EmbedderAuthError, EmbedderError, EmbeddingResult
from deerflow.knowledge.providers import secret_env_var

logger = logging.getLogger(__name__)

_EMBEDDINGS_PATH = "/v1/embeddings"
_KEY_ENV_VAR = secret_env_var("embedding", "openai-compatible")

#: Conservative default: generic endpoints vary wildly in what they accept per call. Ten is
#: the lowest cap actually measured (DashScope compatible-mode refuses 20 with HTTP 400
#: ``batch size is invalid``); picking the known-lowest only ever costs an extra round trip.
DEFAULT_BATCH_LIMIT = 10


class OpenAICompatibleEmbedder:
    """Dense-only embedder for any OpenAI-compatible ``/v1/embeddings`` endpoint."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str | None = None,
        api_key: str | None = None,
        batch_size: int = DEFAULT_BATCH_LIMIT,
        max_retries: int = 3,
        retry_backoff_seconds: float = 0.5,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        if not (base_url or "").strip():
            raise ValueError("通用嵌入 provider 需要服务地址：请设置 rag.embedding_base_url")
        if model is None:
            from deerflow.config.app_config import get_app_config

            model = get_app_config().rag.embedding_model
        self._model = model
        self._base_url = base_url.strip().rstrip("/")
        self._api_key = api_key
        self.batch_size = max(1, batch_size)
        self._max_retries = max(1, max_retries)
        self._retry_backoff = retry_backoff_seconds
        self._client = client
        self._timeout = timeout_seconds

    def _read_api_key(self) -> str | None:
        """Optional credential: an internal endpoint usually needs none (unlike DashScope)."""
        if self._api_key:
            return self._api_key
        return os.environ.get(_KEY_ENV_VAR) if _KEY_ENV_VAR else None

    async def embed(self, texts: Sequence[str], *, text_type: str = "document") -> list[EmbeddingResult]:
        """Embed texts in input order; ``text_type`` is not transmitted (the shape has no such knob)."""
        if not texts:
            return []
        results: list[EmbeddingResult] = []
        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start : start + self.batch_size])
            results.extend(await self._embed_batch(batch))
        return results

    async def _embed_batch(self, texts: list[str]) -> list[EmbeddingResult]:
        payload: dict = {"model": self._model, "input": texts}
        body = await self._post_with_retry(payload)
        items = body.get("data") or []
        by_index = {int(item.get("index", position)): item for position, item in enumerate(items)}
        results: list[EmbeddingResult] = []
        for position in range(len(texts)):
            item = by_index.get(position)
            if item is None:
                raise EmbedderError(f"embedding response is missing index {position}")
            dense = [float(value) for value in (item.get("embedding") or [])]
            if not dense:
                raise EmbedderError(f"embedding response for index {position} carries an empty vector")
            results.append(EmbeddingResult(dense=dense, sparse=SparseVector(indices=[], values=[])))
        return results

    async def _post_with_retry(self, payload: dict) -> dict:
        url = f"{self._base_url}{_EMBEDDINGS_PATH}"
        headers = {"Content-Type": "application/json"}
        api_key = self._read_api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        close_client = False
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            close_client = True
        try:
            last_error: Exception | None = None
            for attempt in range(self._max_retries):
                try:
                    response = await client.post(url, headers=headers, json=payload)
                except httpx.HTTPError as exc:  # transport-level: retryable
                    last_error = EmbedderError(f"embedding request failed: {exc}")
                    if attempt < self._max_retries - 1:
                        await asyncio.sleep(self._retry_backoff * (2**attempt))
                        continue
                    raise last_error from exc
                if response.status_code in (401, 403):
                    raise EmbedderAuthError(f"embedding endpoint rejected the API key (HTTP {response.status_code})")
                if response.status_code == 429 or response.status_code >= 500:
                    last_error = EmbedderError(f"embedding endpoint HTTP {response.status_code}: {response.text[:200]}")
                    if attempt < self._max_retries - 1:
                        await asyncio.sleep(self._retry_backoff * (2**attempt))
                        continue
                    raise last_error
                if response.status_code != 200:
                    raise EmbedderError(f"embedding endpoint HTTP {response.status_code}: {response.text[:200]}")
                try:
                    return response.json()
                except ValueError as exc:
                    raise EmbedderError(f"embedding endpoint returned non-JSON: {response.text[:200]}") from exc
            raise last_error or EmbedderError("embedding request failed")
        finally:
            if close_client:
                await client.aclose()
