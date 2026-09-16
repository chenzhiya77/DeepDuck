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
import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.gateway.deps import get_config, require_admin_user
from deerflow.config.app_config import AppConfig, RagConfig
from deerflow.config.rag_config_file import (
    MASKED_SECRET,
    SECRET_ENV_VARS,
    RagConfigFile,
    atomic_write_rag_config,
    merge_rag_config,
    preserve_secret,
    rag_config_write_lock,
)
from deerflow.config.runtime_paths import project_root
from deerflow.knowledge.embedder import RagConfigurationError, SparseHalfMissingError
from deerflow.knowledge.embedder_factory import build_embedder
from deerflow.knowledge.providers import provider_ids, resolve_provider, secret_env_var

logger = logging.getLogger(__name__)

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


class RagEmbeddingProviderCapability(BaseModel):
    """One embedding provider's declared capability (spec 2026-09-16 §3 D1).

    Only the embedding leg reports this. It is the one allowlist row that carries a
    *capability* flag the UI has to know in advance — whether the provider supplies the
    sparse half itself. The rerank and parse legs have no equivalent: their constraints are
    value dependencies (an address, a token) and are caught when a save is validated.
    """

    provider_id: str = Field(..., description="Curated allowlist id, exactly as the PUT accepts it.")
    emits_sparse: bool = Field(..., description="True when 'provider' is a valid embedding_sparse_source for it.")


class RagConfigResponse(BaseModel):
    """Effective configuration plus where each value came from.

    ``sources`` keys are flattened (``video.asr_model``). Non-secret fields report
    ``ui`` (declared in ``rag_config.json``) or ``config_file``; secret fields report
    ``ui``, ``env`` (no stored value, but the backing environment variable is set) or
    ``unset``.

    ``embedding_providers`` is read-only metadata, not configuration: it lets the settings UI
    refuse a dense-only provider paired with ``sparse_source='provider'`` before the write.
    """

    config: RagConfigFile = Field(..., description="Effective values; stored secrets are masked, env-backed secrets are empty.")
    sources: dict[str, str] = Field(..., description="Origin of each flattened field.")
    embedding_providers: list[RagEmbeddingProviderCapability] = Field(
        default_factory=list,
        description="Capability of every embedding provider in the curated allowlist, in its own order.",
    )


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

    return RagConfigResponse(
        config=RagConfigFile.model_validate(values),
        sources=sources,
        embedding_providers=[
            RagEmbeddingProviderCapability(
                provider_id=provider_id,
                emits_sparse=resolve_provider("embedding", provider_id).emits_sparse,
            )
            for provider_id in provider_ids("embedding")
        ],
    )


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


def _reject_unusable_after_save(config: AppConfig, payload: dict[str, Any]) -> None:
    """Refuse a write whose *result* cannot build an embedder (spec 2026-09-16 §3 D3).

    The judgement is the pipeline's own construction, run against the configuration the write
    will actually produce: ``config.yaml``'s ``rag:`` block overlaid with the file about to be
    persisted. Two things this shape is load-bearing for:

    - the base is ``config.yaml``'s own block, **not** the live ``config.rag`` — the latter
      already carries the file being replaced, so a field the admin just cleared would be
      judged at the value that file gave it (and a fix would be refused);
    - it runs **before** the write, so a rejected request leaves the file untouched.
    """
    pending = merge_rag_config(config.yaml_rag, RagConfigFile.model_validate(payload))
    try:
        build_embedder(config, rag=RagConfig.model_validate(pending))
    except RagConfigurationError as exc:
        raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{exc}") from exc


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
    _reject_unusable_after_save(config, payload)
    target_path = RagConfigFile.resolve_config_path() or (project_root() / "rag_config.json")

    def _write() -> None:
        with rag_config_write_lock:
            atomic_write_rag_config(target_path, payload)

    await asyncio.to_thread(_write)
    return _build_response(config, payload)


#: Mirrors the models-config validate probe: bounded, observational, never persisted.
_PROBE_TIMEOUT_SECONDS = 10.0

#: One short text is enough to see whether the platform answers with a sparse half at all.
_PROBE_TEXT = "probe"

#: The two ways out, in the same words the runtime error and the settings copy use.
_SPARSE_ALTERNATIVES = "请改为「独立稀疏服务」（external）或「本地 BM25」（bm25）。"

#: Probe failures carry their own reason, truncated like the models probe's body sample.
_PROBE_DETAIL_LIMIT = 200


class RagSparseProbeRequest(BaseModel):
    """A candidate embedding configuration to test, before anything is saved.

    ``extra="forbid"`` so this route cannot become a second, unvalidated way to describe
    the RAG configuration.
    """

    model_config = ConfigDict(extra="forbid")

    embedding_provider: str = Field(..., description="Curated allowlist id.")
    embedding_model: str = Field(..., min_length=1, description="Candidate model id.")
    embedding_base_url: str | None = Field(default=None, description="Candidate endpoint; omit to keep the configured one.")
    embedding_api_key: str | None = Field(
        default=None,
        description="Candidate key, or the masking sentinel to reuse the stored/environment one.",
    )


class RagSparseProbeResponse(BaseModel):
    """Three states, never a boolean (spec 2026-09-16 §3 D3).

    ``unverifiable`` exists because "could not check" and "cannot do it" must not be
    conflated: a network outage would otherwise refuse a configuration that works.
    """

    status: Literal["supported", "unsupported", "unverifiable"]
    detail: str


def _probe_api_key(field_name: str, submitted: str | None, config: AppConfig, provider_id: str) -> str | None:
    """The key to probe with: what was submitted, else what this deployment already has.

    The sentinel means "the stored one", exactly as on the PUT; an absent key falls back to
    the file and then to the environment variable *the candidate provider* reads, so a
    deployment whose key lives in the environment can still be probed.
    """
    stored = getattr(_load_stored(), field_name, "") or ""
    if submitted and submitted != MASKED_SECRET:
        return submitted
    if stored:
        return stored
    _, provider_field = _SECRET_LEGS[field_name]
    env_name = _secret_env_name(field_name, config, {provider_field: provider_id})
    return os.environ.get(env_name) if env_name else None


def _probe_detail(text: str) -> str:
    return " ".join(text.split())[:_PROBE_DETAIL_LIMIT]


class RagSparseServiceProbeRequest(BaseModel):
    """A candidate *sparse service* to reach, before anything is saved.

    Distinct from the embedding probe's `RagSparseProbeRequest` (which asks about a *model*):
    this one asks about a *service*. ``extra="forbid"`` for the same reason: this route must not
    become a second, unvalidated way to describe the configuration.
    """

    model_config = ConfigDict(extra="forbid")

    sparse_provider: str = Field(..., description="Curated allowlist id.")
    sparse_base_url: str | None = Field(default=None, description="Candidate endpoint; omit to keep the configured one.")
    sparse_api_key: str | None = Field(
        default=None,
        description="Candidate key, or the masking sentinel to reuse the stored/environment one.",
    )


class RagSparseServiceProbeResponse(BaseModel):
    """Whether the sparse service answered, and whether it answered with anything (D2).

    ``empty`` is its own state because a reachable service that returns no terms for every text
    silently removes the sparse half from every search — the failure mode this whole line exists
    for. Neither ``empty`` nor ``unreachable`` blocks a save: the service may come up later.
    """

    status: Literal["ok", "empty", "unreachable"]
    detail: str


@router.post(
    "/rag/config/probe-embedding",
    response_model=RagSparseProbeResponse,
    summary="Probe Whether an Embedding Model Returns the Sparse Half (admin)",
    description="Runs one real embedding call with the submitted provider and model and reports whether the sparse half comes back. Nothing is persisted.",
)
async def probe_embedding_capability(
    request: Request,
    body: RagSparseProbeRequest,
    config: AppConfig = Depends(get_config),
) -> RagSparseProbeResponse:
    """Answer "can this provider + model supply the sparse half" — and nothing else (§3 D3).

    The provider-level answer is free: when the allowlist row says the provider emits no
    sparse, this replies from the list and never touches the network. Otherwise the question
    is genuinely model-level, so it takes one real call.

    Everything that is not an answer — unreachable, refused, wrong dimension, timeout — is
    reported as ``unverifiable`` with its own reason: reading "could not check" as "cannot do
    it" would refuse configurations that work. This route never replaces the save-time check
    (dimensions and addresses remain the PUT's business).
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    if body.embedding_provider not in provider_ids("embedding"):
        raise HTTPException(status_code=422, detail=f"Unknown embedding provider {body.embedding_provider!r}.")

    spec = resolve_provider("embedding", body.embedding_provider)
    if not spec.emits_sparse:
        return RagSparseProbeResponse(
            status="unsupported",
            detail=f"嵌入 provider {body.embedding_provider!r} 只输出稠密向量 ⇒ 不能由它提供稀疏；{_SPARSE_ALTERNATIVES}",
        )

    candidate = config.rag.model_copy(
        update={
            "embedding_provider": body.embedding_provider,
            "embedding_model": body.embedding_model,
            "embedding_base_url": body.embedding_base_url or config.rag.embedding_base_url,
            "embedding_api_key": _probe_api_key("embedding_api_key", body.embedding_api_key, config, body.embedding_provider),
            # The provider's own sparse output is the thing in question, so ask for exactly that.
            "embedding_sparse_source": "provider",
        }
    )

    try:
        embedder = build_embedder(config, rag=candidate)
        results = await asyncio.wait_for(embedder.embed([_PROBE_TEXT]), timeout=_PROBE_TIMEOUT_SECONDS)
    except SparseHalfMissingError as exc:
        # The call succeeded and the sparse half was empty: the model has answered. The
        # run-time guard raises this instead of handing back an empty vector, which is why
        # the answer arrives as an exception here (spec §3 D5).
        return RagSparseProbeResponse(
            status="unsupported",
            detail=f"模型 {body.embedding_model!r} 只返回了稠密向量 ⇒ 不能由它提供稀疏；{_SPARSE_ALTERNATIVES}（{_probe_detail(str(exc))}）",
        )
    except Exception as exc:  # noqa: BLE001 — this route's job is to always answer with a status
        logger.warning("embedding capability probe failed for %s/%s", body.embedding_provider, body.embedding_model, exc_info=True)
        return RagSparseProbeResponse(
            status="unverifiable",
            detail=f"未能验证（{type(exc).__name__}）：{_probe_detail(str(exc))}",
        )

    if results and results[0].sparse.indices:
        return RagSparseProbeResponse(
            status="supported",
            detail=f"模型 {body.embedding_model!r} 一次调用同时返回稠密与稀疏。",
        )
    return RagSparseProbeResponse(
        status="unsupported",
        detail=f"模型 {body.embedding_model!r} 只返回了稠密向量 ⇒ 不能由它提供稀疏；{_SPARSE_ALTERNATIVES}",
    )


@router.post(
    "/rag/config/probe-sparse",
    response_model=RagSparseServiceProbeResponse,
    summary="Probe Whether the Sparse Service Answers (admin)",
    description="Runs one real `/embed_sparse` call against the submitted service and reports whether it answers with terms. Nothing is persisted.",
)
async def probe_sparse_service(
    request: Request,
    body: RagSparseServiceProbeRequest,
    config: AppConfig = Depends(get_config),
) -> RagSparseServiceProbeResponse:
    """Answer "can we actually reach the sparse service, and does it give us terms" (§3 D1–D3).

    The runtime's own encoder is what gets called, so the request the admin probes with is the
    request an ingest would make. Deliberately **not** built through `build_embedder`: the dense
    leg has nothing to do with this question, and an admin who is mid-edit on the sparse settings
    may not have a complete dense configuration at all.

    Every failure is reported, never raised, and none of them blocks a save — a service that is
    down now may be up in a minute, and refusing the write would be the same mistake the
    `unverifiable` rule exists to avoid.
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    if body.sparse_provider not in provider_ids("sparse"):
        raise HTTPException(status_code=422, detail=f"Unknown sparse provider {body.sparse_provider!r}.")

    spec = resolve_provider("sparse", body.sparse_provider)
    base_url = body.sparse_base_url or config.rag.sparse_base_url
    if not (base_url or "").strip():
        return RagSparseServiceProbeResponse(status="unreachable", detail="未填写稀疏服务地址。")

    from deerflow.reflection import resolve_variable

    kwargs: dict[str, Any] = {"base_url": base_url.strip()}
    api_key = _probe_api_key("sparse_api_key", body.sparse_api_key, config, body.sparse_provider)
    if api_key:
        kwargs["api_key"] = api_key

    try:
        encoder = resolve_variable(spec.implementation)(**kwargs)
        vectors = await asyncio.wait_for(encoder.encode([_PROBE_TEXT]), timeout=_PROBE_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 — this route's job is to always answer with a status
        logger.warning("sparse service probe failed for %s", body.sparse_provider, exc_info=True)
        return RagSparseServiceProbeResponse(
            status="unreachable",
            detail=f"未能连通（{type(exc).__name__}）：{_probe_detail(str(exc))}",
        )

    # No "wrong number of rows" branch here on purpose: the encoder already refuses that
    # (`TEISparseEncoder._encode_batch` compares the row count to the batch), so it arrives as an
    # exception above — a second check here would be unreachable code.
    if vectors[0].indices:
        return RagSparseServiceProbeResponse(status="ok", detail="稀疏服务已连通，并返回了词项。")
    return RagSparseServiceProbeResponse(
        status="empty",
        detail="稀疏服务已连通，但这段文本没有返回任何词项 ⇒ 请确认它加载的是支持稀疏的模型。",
    )
