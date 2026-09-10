"""Resolve the caption VLM's (model, endpoint, key) triple.

Both caption legs are raw OpenAI-compatible calls (``POST {base_url}/chat/completions``),
not LangChain models, so they need the triple explicitly. Naming a configured ``models:``
entry supplies all three from that entry, which is what lets the settings UI offer a plain
model picker instead of asking for an endpoint and a key that the entry already carries.

A value that names no entry is a legacy bare model id and keeps the documented fallback
(``rag.vlm_base_url`` plus the rag file key or the backing environment variable), so a
deployment that only ever set ``rag.vlm_model`` in ``config.yaml`` captions as before.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from deerflow.config.app_config import AppConfig
from deerflow.config.rag_config_file import SECRET_ENV_VARS

#: Provider-side endpoint keys an entry may carry (OpenAI-compatible vs the DeepSeek adapter).
_ENDPOINT_KEYS: tuple[str, ...] = ("base_url", "api_base")


@dataclass(frozen=True, slots=True)
class VlmTarget:
    """Where a caption call goes, and what it authenticates with."""

    model: str
    base_url: str
    api_key: str | None
    source: Literal["model_entry", "legacy"]


def _environment_key(config: AppConfig) -> str | None:
    env_name = config.rag.vlm_api_key_env or SECRET_ENV_VARS["vlm_api_key"]
    return os.environ.get(env_name) or None


def resolve_vlm_target(config: AppConfig, model: str | None = None) -> VlmTarget:
    """Resolve the caption target for ``model``, defaulting to ``rag.vlm_model``.

    ``model`` may be an entry name (preferred) or a bare provider model id (legacy); the
    video leg passes ``rag.video.caption_model`` here when it overrides the shared model.
    """
    declared = (model or config.rag.vlm_model or "").strip()
    entry = config.get_model_config(declared) if declared else None

    if entry is not None:
        dumped = entry.model_dump()
        endpoint = next((dumped[key] for key in _ENDPOINT_KEYS if dumped.get(key)), None)
        return VlmTarget(
            model=entry.model,
            base_url=endpoint or config.rag.vlm_base_url,
            api_key=dumped.get("api_key") or config.rag.vlm_api_key or _environment_key(config),
            source="model_entry",
        )

    return VlmTarget(
        model=declared or config.rag.vlm_model,
        base_url=config.rag.vlm_base_url,
        api_key=config.rag.vlm_api_key or _environment_key(config),
        source="legacy",
    )
