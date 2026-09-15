"""Admin RAG functional-model configuration API (spec 2026-09-10 rag functional-model config §4).

``GET`` reports the *effective* configuration the ingestion pipeline will use — merged
from ``config.yaml`` and the API-writable ``rag_config.json`` — with every secret masked
and each field's origin declared, so the settings UI can show what is in force and where
it comes from. ``PUT`` replaces the whole API-writable object and writes **only**
``rag_config.json``; ``config.yaml`` stays the operator-trusted source and is never
written through the Gateway.

Secrets: a read never returns a stored key (it returns the masking sentinel), and a write
that submits the sentinel keeps the stored value. Omitting a field *removes* it from the
file, which is how an admin reverts a field to ``config.yaml`` (or to the environment,
for a key) — the submitted object is the new file content, not a patch.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.gateway.deps import get_config, require_admin_user
from deerflow.config.app_config import AppConfig
from deerflow.config.rag_config_file import (
    MASKED_SECRET,
    SECRET_ENV_VARS,
    RagConfigFile,
    atomic_write_rag_config,
    preserve_secret,
    rag_config_write_lock,
)
from deerflow.config.runtime_paths import project_root
from deerflow.knowledge.providers import provider_ids, secret_env_var

router = APIRouter(prefix="/api", tags=["rag"])

_ADMIN_DETAIL = "Admin privileges required to manage the RAG configuration."

#: Secret fields: masked on read, sentinel-preserving on write, env-backed when unset.
_SECRET_FIELDS: tuple[str, ...] = ("embedding_api_key", "rerank_api_key", "vlm_api_key", "mineru_api_token", "sparse_api_key")

#: Secret field -> (allowlist leg, the config field naming that leg's provider). A secret's
#: environment fallback is the one the *selected* provider reads, so switching provider
#: re-points it (spec 2026-09-14 §4.1). The caption VLM key is deliberately absent: its env
#: name comes from the plain ``vlm_api_key_env`` field, not from a curated provider.
_SECRET_LEGS: dict[str, tuple[str, str]] = {
    "embedding_api_key": ("embedding", "embedding_provider"),
    "rerank_api_key": ("rerank", "rerank_provider"),
    "mineru_api_token": ("parse", "parse_provider"),
    "sparse_api_key": ("sparse", "sparse_provider"),
}

#: The video sub-block is a nested object in the file; the API reports/receives it as one.
_VIDEO_FIELDS: tuple[str, ...] = ("asr_provider", "asr_model", "caption_model")


class RagConfigResponse(BaseModel):
    """Effective configuration plus where each value came from.

    ``sources`` keys are flattened (``video.asr_model``). Non-secret fields report
    ``ui`` (declared in ``rag_config.json``) or ``config_file``; secret fields report
    ``ui``, ``env`` (no stored value, but the backing environment variable is set) or
    ``unset``.
    """

    config: RagConfigFile = Field(..., description="Effective values; stored secrets are masked, env-backed secrets are empty.")
    sources: dict[str, str] = Field(..., description="Origin of each flattened field.")


def _declared_flat(stored: RagConfigFile) -> dict[str, Any]:
    """Flatten the file's declared fields, dropping blanks (an empty string is 'not set')."""
    declared: dict[str, Any] = {}
    for name, value in stored.model_dump(exclude_none=True).items():
        if name == "video":
            for key, sub in (value or {}).items():
                if sub not in (None, ""):
                    declared[f"video.{key}"] = sub
        elif value != "":
            declared[name] = value
    return declared


def _prune_empty(data: dict[str, Any]) -> dict[str, Any]:
    """Drop empty strings / emptied nested blocks so 'cleared' means absent in the file."""
    pruned: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, dict):
            nested = _prune_empty(value)
            if nested:
                pruned[key] = nested
        elif value not in (None, ""):
            pruned[key] = value
    return pruned


def _secret_env_name(field_name: str, config: AppConfig, written: dict[str, Any]) -> str | None:
    """The environment variable backing a secret when the file declares none.

    Returns ``None`` when no fallback exists — the local MinerU service ships without auth,
    so a deployment that selects it has nothing to point at.
    """
    if field_name == "vlm_api_key":
        return config.rag.vlm_api_key_env or SECRET_ENV_VARS[field_name]
    leg, provider_field = _SECRET_LEGS[field_name]
    # The submitted object wins: a PUT that switches provider must report the new fallback
    # in its own response, before ``get_app_config()`` reloads the file it just wrote.
    provider = written.get(provider_field) or getattr(config.rag, provider_field, None)
    if provider is None:
        provider = provider_ids(leg)[0]
    return secret_env_var(leg, provider)


def _load_stored() -> RagConfigFile:
    """Read the API-writable file, surfacing a malformed one as a 500 rather than a silent reset."""
    try:
        return RagConfigFile.from_file()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"rag_config.json is invalid: {exc}") from exc


def _build_response(config: AppConfig, written: dict[str, Any], *, env: dict[str, str] | None = None) -> RagConfigResponse:
    """Compose the read shape from the file just written plus the current config.

    ``written`` is the new file content, so a field it carries is ``ui``-sourced; anything
    it omits falls back to the effective config (config.yaml) or, for a secret, to the
    environment.
    """
    environment = os.environ if env is None else env
    values: dict[str, Any] = {}
    sources: dict[str, str] = {}

    for name in RagConfigFile.model_fields:
        if name == "video":
            written_video = written.get("video") or {}
            values["video"] = {key: written_video.get(key, getattr(config.rag.video, key)) for key in _VIDEO_FIELDS}
            for key in _VIDEO_FIELDS:
                sources[f"video.{key}"] = "ui" if key in written_video else "config_file"
        elif name in _SECRET_FIELDS:
            values[name] = MASKED_SECRET if written.get(name) else ""
            if written.get(name):
                sources[name] = "ui"
            else:
                env_name = _secret_env_name(name, config, written)
                sources[name] = "env" if env_name and environment.get(env_name) else "unset"
        else:
            values[name] = written.get(name, getattr(config.rag, name))
            sources[name] = "ui" if name in written else "config_file"

    return RagConfigResponse(config=RagConfigFile.model_validate(values), sources=sources)


@router.get(
    "/rag/config",
    response_model=RagConfigResponse,
    summary="Get RAG Functional-Model Configuration (admin)",
    description="Effective embedding / rerank / caption / extraction / ASR settings with secrets masked and each field's origin.",
)
async def get_rag_config(
    request: Request,
    config: AppConfig = Depends(get_config),
) -> RagConfigResponse:
    """Report the effective RAG configuration the ingestion pipeline will use."""
    await require_admin_user(request, detail=_ADMIN_DETAIL)
    return _build_response(config, _declared_flat(_load_stored()))


@router.put(
    "/rag/config",
    response_model=RagConfigResponse,
    summary="Replace RAG Functional-Model Configuration (admin)",
    description="Replace the API-writable rag_config.json. config.yaml is never written; a sentinel keeps a stored secret.",
)
async def put_rag_config(
    request: Request,
    body: RagConfigFile,
    config: AppConfig = Depends(get_config),
) -> RagConfigResponse:
    """Validate and persist the whole API-writable RAG configuration object."""
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    stored = _load_stored()
    submitted: dict[str, Any] = body.model_dump(exclude_none=True)

    for name in _SECRET_FIELDS:
        if name in submitted and submitted[name] == MASKED_SECRET:
            keep = getattr(stored, name, None)
            if keep:
                submitted[name] = keep
            else:
                submitted.pop(name)
        elif name in submitted:
            submitted[name] = preserve_secret(submitted[name], getattr(stored, name, "") or "")

    payload = _prune_empty(submitted)
    target_path = RagConfigFile.resolve_config_path() or (project_root() / "rag_config.json")

    def _write() -> None:
        with rag_config_write_lock:
            atomic_write_rag_config(target_path, payload)

    await asyncio.to_thread(_write)
    return _build_response(config, payload)
