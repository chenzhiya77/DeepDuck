"""Resolve the caption VLM's (model, endpoint, key) triple, and the protocol it speaks.

Both caption legs are raw HTTP calls, and what they send depends on the entry's provider:
the OpenAI shape (``POST {base_url}/chat/completions``) or Anthropic's Messages shape
(``POST {base_url}/v1/messages``). Naming a configured ``models:`` entry supplies the triple
from that entry — which is what lets the settings UI offer a plain model picker instead of
asking for an endpoint and a key that the entry already carries — and the entry's ``use:``
class is what decides the dialect.

A value that names no entry is a legacy bare model id and keeps the documented fallback
(``rag.vlm_base_url`` plus the rag file key or the backing environment variable), so a
deployment that only ever set ``rag.vlm_model`` in ``config.yaml`` captions as before.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from deerflow.config.app_config import AppConfig
from deerflow.config.models_config import reverse_lookup_provider
from deerflow.config.rag_config_file import SECRET_ENV_VARS

#: Provider-side endpoint keys an entry may carry (OpenAI-compatible vs the DeepSeek adapter).
_ENDPOINT_KEYS: tuple[str, ...] = ("base_url", "api_base")

Dialect = Literal["openai", "anthropic"]

#: Which protocol a caption call speaks, read off the entry's ``use:`` class through the
#: same allowlist ``/api/models`` reports — never a field of its own, because the entry
#: already names the client that serves it. A class the allowlist cannot place is *not*
#: evidence of a third shape, so it keeps the OpenAI one these legs have always sent.
_DIALECT_BY_PROVIDER: dict[str, Dialect] = {"anthropic": "anthropic"}


def _dialect_for(use: str) -> Dialect:
    return _DIALECT_BY_PROVIDER.get(reverse_lookup_provider(use) or "", "openai")


@dataclass(frozen=True, slots=True)
class VlmTarget:
    """Where a caption call goes, what it authenticates with, and which protocol it speaks."""

    model: str
    base_url: str
    api_key: str | None
    dialect: Dialect
    source: Literal["model_entry", "legacy"]


def _environment_key(config: AppConfig) -> str | None:
    env_name = config.rag.vlm_api_key_env or SECRET_ENV_VARS["vlm_api_key"]
    return os.environ.get(env_name) or None


def resolve_vlm_target(config: AppConfig, model: str | None = None) -> VlmTarget:
    """Resolve the caption target for ``model``, defaulting to ``rag.vlm_model``.

    ``model`` may be an entry name (preferred) or a bare provider model id (legacy); the
    video leg passes ``rag.video.caption_model`` here when it overrides the shared model.
    """
    from deerflow.knowledge.model_target import require_rag_model_name

    # The declaration is the caller's argument, else ``rag.vlm_model``; everything below that
    # (the RAG default, then the first model) is the shared chain, so both caption legs and
    # the two LLM roles answer the same way. No models at all is a configuration error rather
    # than an empty ``model`` in the request.
    declared = require_rag_model_name(config, (model or config.rag.vlm_model or "").strip() or None, role="文档图片配文")
    entry = config.get_model_config(declared)

    if entry is not None:
        dumped = entry.model_dump()
        endpoint = next((dumped[key] for key in _ENDPOINT_KEYS if dumped.get(key)), None)
        return VlmTarget(
            model=entry.model,
            base_url=endpoint or config.rag.vlm_base_url,
            api_key=dumped.get("api_key") or config.rag.vlm_api_key or _environment_key(config),
            dialect=_dialect_for(entry.use),
            source="model_entry",
        )

    return VlmTarget(
        model=declared or config.rag.vlm_model,
        base_url=config.rag.vlm_base_url,
        api_key=config.rag.vlm_api_key or _environment_key(config),
        dialect="openai",
        source="legacy",
    )
