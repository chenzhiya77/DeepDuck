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
from app.gateway.services.rag_migration import migration_running, migration_status, start_migration
from deerflow.config.app_config import AppConfig, RagConfig
from deerflow.config.rag_config_file import (
    MASKED_SECRET,
    RagConfigFile,
    merge_rag_config,
    preserve_secret,
    write_rag_config,
)
from deerflow.knowledge.dimension_probe import CANDIDATE_DIMENSIONS, DimensionProbeError, probe_dimensions
from deerflow.knowledge.embedder import EmbedderAuthError, RagConfigurationError, SparseHalfMissingError
from deerflow.knowledge.embedder_factory import build_embedder, dimension_mismatch_message, effective_dimension
from deerflow.knowledge.model_target import model_not_found_message, rag_target_missing
from deerflow.knowledge.parser import build_parse_provider
from deerflow.knowledge.providers import provider_ids, resolve_provider, secret_env_var
from deerflow.knowledge.reranker import RerankerAuthError
from deerflow.knowledge.reranker_factory import build_reranker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["rag"])

_ADMIN_DETAIL = "Admin privileges required to manage the RAG configuration."

#: Secret fields: masked on read, sentinel-preserving on write, env-backed when unset.
_SECRET_FIELDS: tuple[str, ...] = ("embedding_api_key", "rerank_api_key", "mineru_api_token", "sparse_api_key", "asr_api_key")

#: Secret field -> (allowlist leg, the config field naming that leg's provider). A secret's
#: environment fallback is the one the *selected* provider reads, so switching provider
#: re-points it (spec 2026-09-14 §4.1). The caption VLM key has no row here because it has
#: no fallback at all any more: it comes from the model entry (spec 2026-09-23 D10.1/R14).
_SECRET_LEGS: dict[str, tuple[str, str]] = {
    "embedding_api_key": ("embedding", "embedding_provider"),
    "rerank_api_key": ("rerank", "rerank_provider"),
    "mineru_api_token": ("parse", "parse_provider"),
    "sparse_api_key": ("sparse", "sparse_provider"),
    # The ASR leg's provider is the one selection nested inside the `video` block, so this
    # path is dotted on purpose and read with `_read_field` (spec 2026-09-28 D4).
    "asr_api_key": ("asr", "video.asr_provider"),
}

#: The video sub-block is a nested object in the file; the API reports/receives it as one.
_VIDEO_FIELDS: tuple[str, ...] = ("asr_provider", "asr_model")


class RagEmbeddingProviderCapability(BaseModel):
    """One embedding provider's declared capability (spec 2026-09-16 §3 D1).

    Only the embedding leg reports this. It is the one allowlist row that carries a
    *capability* flag the UI has to know in advance — whether the provider supplies the
    sparse half itself. The rerank and parse legs have no equivalent: their constraints are
    value dependencies (an address, a token) and are caught when a save is validated.
    """

    provider_id: str = Field(..., description="Curated allowlist id, exactly as the PUT accepts it.")
    emits_sparse: bool = Field(..., description="True when 'provider' is a valid embedding_sparse_source for it.")
    has_fixed_endpoint: bool = Field(
        ...,
        description="True when the vendor fixes this provider's endpoint, so the address field is read-only.",
    )
    default_endpoint: str | None = Field(
        ...,
        description="The vendor's own endpoint, used when rag.embedding_base_url is empty; None when it has none.",
    )


class RagConfigResponse(BaseModel):
    """Effective configuration plus where each value came from.

    ``sources`` keys are flattened (``video.asr_model``). Non-secret fields report
    ``ui`` (declared in ``rag_config.json``) or ``config_file``; secret fields report
    ``ui``, ``env`` (no stored value, but the backing environment variable is set) or
    ``unset``.

    ``embedding_providers`` is read-only metadata, not configuration: it lets the settings UI
    refuse a dense-only provider paired with ``sparse_source='provider'`` before the write.

    ``warning`` reports that a save could not be *verified* — the endpoint was unreachable,
    timed out, or refused the credentials — as opposed to being found unusable, which is a 400.
    It is deliberately always present and ``null`` when there is nothing to say: the
    ``exclude_none`` idiom used by the models validate route would have to be applied to this
    whole response, and it is recursive, so every ``null`` inside ``config`` would disappear
    too (spec 2026-09-17 save-time probe §3 D3).
    """

    config: RagConfigFile = Field(..., description="Effective values; stored secrets are masked, env-backed secrets are empty.")
    sources: dict[str, str] = Field(..., description="Origin of each flattened field.")
    embedding_providers: list[RagEmbeddingProviderCapability] = Field(
        default_factory=list,
        description="Capability of every embedding provider in the curated allowlist, in its own order.",
    )
    rerank_providers: list[RerankProviderCapability] = Field(
        default_factory=list,
        description="Capability of every rerank provider in the curated allowlist, in its own order.",
    )
    asr_providers: list[AsrProviderCapability] = Field(
        default_factory=list,
        description="Capability of every ASR provider in the curated allowlist, in its own order.",
    )
    warning: str | None = Field(
        default=None,
        description="Why the saved configuration could not be verified (null when it was, or was not probed).",
    )
    migration: RagMigrationStatus | None = Field(
        default=None,
        description="The width migration this save started or the last one's verdict (null when none ever ran).",
    )


class RagMigrationStatus(BaseModel):
    """Where the width migration stands (spec 2026-09-26 D5-7).

    ``running`` is the only state a save can leave behind: the written file still declares
    the *old* width, and the switch is an atomic replace inside the background task. So a
    reader must treat ``config.embedding_dimension`` as "what is in force", and
    ``target_dimension`` as what becomes true when this turns ``succeeded``.
    """

    state: Literal["running", "succeeded", "failed"]
    target_dimension: int
    detail: str | None = None
    progress: dict[str, int] | None = None


class RerankProviderCapability(BaseModel):
    """One rerank provider's declared capability (spec 2026-09-17 alignment §3 D3).

    The same address rule as the embedding block, and deliberately a *different shape*: the
    rerank leg has no sparse half, so there is no ``emits_sparse`` here. Naming it
    ``rerank_providers`` rather than generalising ``embedding_providers`` keeps that key intact
    for every existing consumer.
    """

    provider_id: str = Field(..., description="Curated allowlist id, exactly as the PUT accepts it.")
    has_fixed_endpoint: bool = Field(
        ...,
        description="True when the vendor fixes this provider's endpoint, so the address field is read-only.",
    )
    default_endpoint: str | None = Field(
        ...,
        description="The vendor's own endpoint, used when rag.rerank_base_url is empty; None when it has none.",
    )


class AsrProviderCapability(BaseModel):
    """One ASR provider's declared capability (spec 2026-09-28 §3).

    The ASR row reads exactly one thing from this block: what to show greyed out in the
    endpoint field while it is empty. Deliberately narrower than the two retrieval blocks —
    their ``has_fixed_endpoint`` no longer drives anything in the UI (2026-09-25
    rag-endpoint-unlock retired the lock and the reset-to-default), so carrying it here would
    only add a second field nothing reads.
    """

    provider_id: str = Field(..., description="Curated allowlist id, exactly as the PUT accepts it.")
    default_endpoint: str | None = Field(..., description="The vendor's own endpoint, shown as the address field's placeholder; None when the row has none.")


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


def _read_field(source: Any, path: str) -> Any:
    """Read a dotted field path out of a payload dict or the live config object.

    Four of the five secret-bearing legs name their provider with a top-level field; the ASR
    leg's lives inside the nested ``video`` block. Without this the lookup would read nothing,
    fall back to the allowlist's first row, and report the wrong environment variable — a
    silent answer rather than an error (spec 2026-09-28 D4).
    """
    value = source
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else getattr(value, part, None)
        if value is None:
            return None
    return value


def _secret_env_name(field_name: str, config: AppConfig, written: dict[str, Any]) -> str | None:
    """The environment variable backing a secret when the file declares none.

    Returns ``None`` when no fallback exists — the local MinerU service ships without auth,
    so a deployment that selects it has nothing to point at.
    """
    leg, provider_field = _SECRET_LEGS[field_name]
    # The submitted object wins: a PUT that switches provider must report the new fallback
    # in its own response, before ``get_app_config()`` reloads the file it just wrote.
    provider = _read_field(written, provider_field) or _read_field(config.rag, provider_field)
    if provider is None:
        provider = provider_ids(leg)[0]
    return secret_env_var(leg, provider)


def _load_stored() -> RagConfigFile:
    """Read the API-writable file, surfacing a malformed one as a 500 rather than a silent reset."""
    try:
        return RagConfigFile.from_file()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"rag_config.json is invalid: {exc}") from exc


def _build_response(config: AppConfig, written: dict[str, Any], *, env: dict[str, str] | None = None, warning: str | None = None, migration: dict[str, Any] | None = None) -> RagConfigResponse:
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
        embedding_providers=_embedding_provider_capabilities(),
        rerank_providers=_rerank_provider_capabilities(),
        asr_providers=_asr_provider_capabilities(),
        warning=warning,
        migration=migration,
    )


def _embedding_provider_capabilities() -> list[RagEmbeddingProviderCapability]:
    """The embedding leg of the allowlist, in its own order — never a second copy of it.

    The address keys ride here rather than being hardcoded in the UI: the "field is read-only
    because the vendor fixes it" rule has to follow the *row*, not a provider name, or adding a
    second such provider silently leaves the field editable (spec 2026-09-17 §3 D1).
    """
    capabilities: list[RagEmbeddingProviderCapability] = []
    for provider_id in provider_ids("embedding"):
        spec = resolve_provider("embedding", provider_id)
        capabilities.append(
            RagEmbeddingProviderCapability(
                provider_id=provider_id,
                emits_sparse=spec.emits_sparse,
                has_fixed_endpoint=spec.has_fixed_endpoint,
                default_endpoint=spec.default_endpoint,
            )
        )
    return capabilities


def _rerank_provider_capabilities() -> list[RerankProviderCapability]:
    """The rerank leg of the allowlist, in its own order — the same rule, its own block.

    Shape differs from the embedding block on purpose: a rerank provider has no sparse half to
    declare (spec 2026-09-17 alignment §3 D3).
    """
    capabilities: list[RerankProviderCapability] = []
    for provider_id in provider_ids("rerank"):
        spec = resolve_provider("rerank", provider_id)
        capabilities.append(
            RerankProviderCapability(
                provider_id=provider_id,
                has_fixed_endpoint=spec.has_fixed_endpoint,
                default_endpoint=spec.default_endpoint,
            )
        )
    return capabilities


def _asr_provider_capabilities() -> list[AsrProviderCapability]:
    """The ASR leg of the allowlist, in its own order — the row's placeholder source.

    The in-process engines and the generic protocol tier declare no default, so their endpoint
    field keeps the shared example placeholder; only the vendor row has one to show.
    """
    capabilities: list[AsrProviderCapability] = []
    for provider_id in provider_ids("asr"):
        spec = resolve_provider("asr", provider_id)
        capabilities.append(AsrProviderCapability(provider_id=provider_id, default_endpoint=spec.default_endpoint))
    return capabilities


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


def _pending_rag(config: AppConfig, payload: dict[str, Any]) -> RagConfig:
    """The configuration this write will actually produce.

    The base is ``config.yaml``'s own ``rag:`` block, **not** the live ``config.rag`` — the
    latter already carries the file being replaced, so a field the admin just cleared would be
    judged at the value that file gave it (and the fix would be refused).
    """
    return RagConfig.model_validate(merge_rag_config(config.yaml_rag, RagConfigFile.model_validate(payload)))


def _reject_unusable_role_targets(config: AppConfig, pending: RagConfig) -> None:
    """Refuse a write whose *declared* model targets cannot be used (spec 2026-09-23 D10.1).

    Only what the payload and ``config.yaml`` declare is judged: the RAG default and the five
    role fields. A target the system would pick itself — the first configured model, or the
    default standing in for a blank role — is never a refusal reason (D3), so a blank field is
    skipped here. Two failures are possible and they are different errors: a name with no entry
    at all (the factory's own sentence, D9) and an entry that exists but is unusable
    (`rag_target_missing`, D10.1). Pure lookups: no SDK is constructed and nothing goes out.
    """
    for field in ("default_model", "extract_model", "judge_model", "vlm_model", "wiki_model", "synthesis_model"):
        name = getattr(pending, field, None)
        if not isinstance(name, str) or not name.strip():
            continue
        if config.get_model_config(name) is None:
            # A declared name with no entry is refused for all six fields, the default
            # included: the save *is* the declaration, so an unknown name is a usage error
            # there. D3's warning-and-fall-back is the *runtime* path, where a default that
            # used to be valid can go stale after a model is removed.
            raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{model_not_found_message(name)}")
        reason = rag_target_missing(config, name, role=field)
        if reason is not None:
            raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{reason}")


def _reject_unusable_after_save(pending: RagConfig) -> None:
    """Refuse a write whose *result* cannot build the pipeline (spec 2026-09-16 §3 D3).

    The judgement is the pipeline's own construction, run against the configuration the write
    will actually produce, and it runs **before** the write — so a rejected request leaves the
    file untouched.

    **All three legs are constructed** (spec 2026-09-17 alignment §3 D2): building only the
    embedder answered for one half, so a rerank provider that needs an address, or a local parser
    without one, saved happily and blew up on the next retrieval or ingest. Each construction is
    offline — no provider is called — so covering the other two legs costs no network round trip
    (and therefore needs none of the embedding probe's "could not verify" handling).
    """
    try:
        build_embedder(rag=pending)
        build_reranker(rag=pending)
        build_parse_provider(rag=pending)
    except RagConfigurationError as exc:
        raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{exc}") from exc


#: The embedding settings the save-time probe answers for (spec 2026-09-17 save-time probe §3 D2).
_WATCHED_EMBEDDING_FIELDS: tuple[str, ...] = (
    "embedding_provider",
    "embedding_model",
    "embedding_base_url",
    "embedding_api_key",
    "embedding_dimension",
    "embedding_sparse_source",
)

_SAVED_BUT_UNVERIFIED = "提交后的配置已保存，但未能验证："


def _embedding_signature(rag: RagConfig) -> tuple[Any, ...]:
    """The watched values, with "unset" spelled one way (blank == absent)."""
    values: list[Any] = []
    for name in _WATCHED_EMBEDDING_FIELDS:
        value = getattr(rag, name, None)
        values.append(value.strip() or None if isinstance(value, str) else value)
    return tuple(values)


def _unverified_warning(exc: BaseException) -> str:
    """One sentence saying *why* there is no verdict — never the same words for both causes."""
    if isinstance(exc, EmbedderAuthError):
        return f"{_SAVED_BUT_UNVERIFIED}凭据被拒（{_probe_detail(str(exc))}）"
    if isinstance(exc, TimeoutError):
        return f"{_SAVED_BUT_UNVERIFIED}探测超时（超过 {_PROBE_TIMEOUT_SECONDS:g} 秒）"
    return f"{_SAVED_BUT_UNVERIFIED}未能连通（{type(exc).__name__}）：{_probe_detail(str(exc))}"


async def _probe_after_save(pending: RagConfig) -> str | None:
    """Make one real embedding call against the configuration about to be written.

    Splitting the two outcomes is the whole point: an **answer** ("this cannot work") is a 400,
    while *not getting an answer* is a 200 with a ``warning``. Refusing the second case would
    block the only exit an admin has when the configuration in force is the broken one.
    """
    try:
        embedder = build_embedder(rag=pending)
        results = await asyncio.wait_for(embedder.embed([_PROBE_TEXT]), timeout=_PROBE_TIMEOUT_SECONDS)
    except RagConfigurationError as exc:
        # Caught *before* the blanket handler below and before anything else: a wrong width or an
        # empty sparse half is the model's answer, and burying it as "could not verify" is exactly
        # the hole this probe exists to close (spec §3 D4).
        raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 — everything else means "no verdict", which never blocks a save
        logger.warning("embedding probe after save failed for provider %s", pending.embedding_provider, exc_info=True)
        return _unverified_warning(exc)

    # Measured here rather than read back from the runtime guard: that guard is a once-per-process
    # verdict keyed by (provider, url, model), so a warm key would let a second save through (D6).
    # Judged against the width *this save* would put in force, not against 1024 (spec 2026-09-26
    # D1 乙): with the declaration authoritative, the question is "can the model do the declared N".
    measured = len(results[0].dense) if results else 0
    expected = effective_dimension(pending)
    if measured != expected:
        raise HTTPException(status_code=400, detail=f"提交后的配置仍不可用：{dimension_mismatch_message(measured, expected)}")
    return None


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
    pending = _pending_rag(config, payload)
    _reject_unusable_role_targets(config, pending)
    _reject_unusable_after_save(pending)

    # A width change is not a field edit: every stored vector belongs to the old space, so
    # the save starts a rebuild and the new width only takes effect when it finishes
    # (spec 2026-09-26 D5-7). Refused while one is already running — a second migration
    # would race the first one's flip.
    live_width = effective_dimension(config.rag)
    target_width = effective_dimension(pending)
    migrating = target_width != live_width
    if migrating and migration_running():
        raise HTTPException(status_code=409, detail="已有一次维度迁移正在进行；等它结束再改这一格。")

    # One real call, but only when one of the watched embedding settings actually changed: an
    # unrelated edit (rerank, parse, …) must not turn every save into a network round trip.
    warning = None
    if _embedding_signature(config.rag) != _embedding_signature(pending):
        warning = await _probe_after_save(pending)

    written = payload
    service = None
    if migrating:
        # Everything else lands now; the width stays at its old value until the rebuild is
        # complete, which is what keeps the running deployment on the generation that holds
        # its vectors. The service is resolved first: a 503 must not leave a half-applied save.
        service = getattr(request.app.state, "knowledge_service", None)
        if service is None:  # pragma: no cover - the gateway always wires it
            raise HTTPException(status_code=503, detail="维度迁移需要知识库服务在线，本次保存没有写入。")
        written = dict(payload)
        stored_dimension = getattr(stored, "embedding_dimension", None)
        if stored_dimension is None:
            written.pop("embedding_dimension", None)
        else:
            written["embedding_dimension"] = stored_dimension

    await asyncio.to_thread(write_rag_config, written)
    if migrating:
        start_migration(
            store=service.store,
            graph_store=service.graph_store,
            wiki_store=service.wiki_store,
            url=config.rag.qdrant_url,
            old_width=live_width,
            target_width=target_width,
            target_payload=payload,
            embedder=build_embedder(rag=pending),
        )
    return _build_response(config, written, warning=warning, migration=migration_status())


@router.get(
    "/rag/config/migration",
    response_model=RagMigrationStatus | None,
    summary="Read the vector-library width migration status (admin)",
    description="Where the migration this deployment started stands; null when none ever ran.",
)
async def get_rag_migration_status(request: Request) -> RagMigrationStatus | None:
    """Poll payload for the settings entry while a width change works through the library."""
    await require_admin_user(request, detail=_ADMIN_DETAIL)
    status = migration_status()
    return None if status is None else RagMigrationStatus.model_validate(status)


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


# ── dimension probe + per-leg connectivity (spec 2026-09-26 §3) ────────────


class RagDimensionProbeRequest(BaseModel):
    """A candidate embedding model whose accepted widths are in question.

    ``extra="forbid"`` for the family's reason: this route must not become a second way to
    describe the configuration. ``embedding_api_key`` accepts the masking sentinel, so the admin
    never retypes a stored key.
    """

    model_config = ConfigDict(extra="forbid")

    embedding_provider: str = Field(..., description="Curated allowlist id.")
    embedding_model: str = Field(..., description="Model id to probe.")
    embedding_base_url: str | None = Field(default=None, description="Candidate endpoint; omit to keep the configured one.")
    embedding_api_key: str | None = Field(default=None, description="Candidate key, or the masking sentinel to reuse the stored/environment one.")


class RagDimensionProbeResponse(BaseModel):
    """Which widths the model accepts; ``status`` separates "no answer" from "an answer"."""

    status: Literal["ok", "unreachable"]
    type: Literal["tiered", "range", "fixed"] | None = None
    native: int | None = Field(default=None, description="The width the model produces when nobody asks for one.")
    values: list[int] = Field(default_factory=list, description="tiered: the widths that passed; range/fixed: the single usable width.")
    candidates: list[int] = Field(default_factory=list, description="The backend's candidate table, so the frontend never keeps a second copy.")
    detail: str


@router.post(
    "/rag/config/probe-dimensions",
    response_model=RagDimensionProbeResponse,
    summary="Probe Which Dimensions an Embedding Model Accepts (admin)",
    description="Makes real calls with candidate widths and reports the shape of the answer. Nothing is persisted.",
)
async def probe_embedding_dimensions(
    request: Request,
    body: RagDimensionProbeRequest,
    config: AppConfig = Depends(get_config),
) -> RagDimensionProbeResponse:
    """Classify the model and list what it accepts (spec §3 探针实现).

    Every failure to get an answer — unreachable, refused, timed out — is ``unreachable`` with
    its own reason, because this row reports a state rather than refusing a save.
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    if body.embedding_provider not in provider_ids("embedding"):
        raise HTTPException(status_code=422, detail=f"Unknown embedding provider {body.embedding_provider!r}.")

    try:
        result = await asyncio.wait_for(
            probe_dimensions(
                provider=body.embedding_provider,
                model=body.embedding_model,
                base_url=body.embedding_base_url or config.rag.embedding_base_url or "",
                api_key=_probe_api_key("embedding_api_key", body.embedding_api_key, config, body.embedding_provider),
                text=_PROBE_TEXT,
                timeout=_PROBE_TIMEOUT_SECONDS,
            ),
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        return RagDimensionProbeResponse(status="unreachable", candidates=list(CANDIDATE_DIMENSIONS), detail=f"未能探明：探测超时（超过 {_PROBE_TIMEOUT_SECONDS:g} 秒）。")
    except DimensionProbeError as exc:
        logger.warning("dimension probe failed for %s/%s", body.embedding_provider, body.embedding_model, exc_info=True)
        return RagDimensionProbeResponse(status="unreachable", candidates=list(CANDIDATE_DIMENSIONS), detail=f"未能探明（{type(exc).__name__}）：{_probe_detail(str(exc))}")

    return RagDimensionProbeResponse(
        status="ok",
        type=result.type,
        native=result.native,
        values=list(result.values),
        candidates=list(CANDIDATE_DIMENSIONS),
        detail=result.detail,
    )


class RagConnectivityProbeRequest(BaseModel):
    """One leg's candidate coordinates for a single connectivity call (spec §3 连通探针)."""

    model_config = ConfigDict(extra="forbid")

    leg: Literal["embedding", "rerank"]
    provider: str = Field(..., description="Curated allowlist id of that leg.")
    model: str | None = Field(default=None, description="Candidate model id; omit to keep the configured one.")
    base_url: str | None = Field(default=None, description="Candidate endpoint; omit to keep the configured one.")
    api_key: str | None = Field(default=None, description="Candidate key, or the masking sentinel.")
    embedding_dimension: int | None = Field(default=None, description="The width in force; the embedding leg sends it, so one call also proves the width is obtainable.")


class RagConnectivityProbeResponse(BaseModel):
    """Four ways an embedding leg can fail to be usable, and one that is not a failure at all.

    ``dimension_unavailable`` and ``half_missing`` are both *answers* — the endpoint reached us
    and its answer cannot be used (the width is not on offer; the sparse half did not come) —
    as opposed to ``refused`` / ``unreachable``, which are "no answer". Collapsing the latter
    pair into a single "failed" would send the admin to the wrong repair.
    """

    status: Literal["ok", "refused", "unreachable", "dimension_unavailable", "half_missing"]
    detail: str
    measured_dimension: int | None = None


@router.post(
    "/rag/config/probe-connectivity",
    response_model=RagConnectivityProbeResponse,
    summary="Probe One Leg's Connectivity (admin)",
    description="One real call through the pipeline's own construction. Nothing is persisted.",
)
async def probe_leg_connectivity(
    request: Request,
    body: RagConnectivityProbeRequest,
    config: AppConfig = Depends(get_config),
) -> RagConnectivityProbeResponse:
    """Reach the candidate leg once and keep "no answer" apart from "an answer we cannot use".

    Both legs go through the same factories the runtime uses (spec §3): building the client here
    by hand is how a probe would start certifying a request shape the ingest never sends.
    """
    await require_admin_user(request, detail=_ADMIN_DETAIL)

    if body.provider not in provider_ids(body.leg):
        raise HTTPException(status_code=422, detail=f"{body.leg} 腿不认识 provider {body.provider!r}（受控 allowlist）。")

    if body.leg == "embedding":
        requested = body.embedding_dimension if body.embedding_dimension is not None else effective_dimension(config.rag)
        candidate = config.rag.model_copy(
            update={
                "embedding_provider": body.provider,
                "embedding_model": body.model or config.rag.embedding_model,
                "embedding_base_url": body.base_url or config.rag.embedding_base_url,
                "embedding_api_key": _probe_api_key("embedding_api_key", body.api_key, config, body.provider),
                "embedding_dimension": requested,
            }
        )
        try:
            embedder = build_embedder(config, rag=candidate)
            results = await asyncio.wait_for(embedder.embed([_PROBE_TEXT]), timeout=_PROBE_TIMEOUT_SECONDS)
        except EmbedderAuthError as exc:
            return RagConnectivityProbeResponse(status="refused", detail=f"凭据被拒（{_probe_detail(str(exc))}）")
        except SparseHalfMissingError as exc:
            # The call came back — with a dense half where both were promised. Same family as
            # `dimension_unavailable`: an answer we cannot use, never "could not connect".
            return RagConnectivityProbeResponse(status="half_missing", detail=f"连得上，但这个模型没给稀疏那一半：{_probe_detail(str(exc))}")
        except Exception as exc:  # noqa: BLE001 — everything else means "no answer", with its own reason
            logger.warning("connectivity probe failed for embedding/%s", body.provider, exc_info=True)
            return RagConnectivityProbeResponse(status="unreachable", detail=f"未能连通（{type(exc).__name__}）：{_probe_detail(str(exc))}")

        measured = len(results[0].dense) if results else 0
        if measured and measured != requested:
            return RagConnectivityProbeResponse(
                status="dimension_unavailable",
                measured_dimension=measured,
                detail=f"连得上，但要不到 {requested} 维：实测返回 {measured} 维 ⇒ 请改选它能给的维度。",
            )
        return RagConnectivityProbeResponse(status="ok", measured_dimension=measured or None, detail=f"连通正常，实测 {measured} 维。")

    candidate = config.rag.model_copy(
        update={
            "rerank_provider": body.provider,
            "rerank_model": body.model or config.rag.rerank_model,
            "rerank_base_url": body.base_url or config.rag.rerank_base_url,
            "rerank_api_key": _probe_api_key("rerank_api_key", body.api_key, config, body.provider),
        }
    )
    try:
        reranker = build_reranker(config, rag=candidate)
        await asyncio.wait_for(reranker.rerank(_PROBE_TEXT, [_PROBE_TEXT]), timeout=_PROBE_TIMEOUT_SECONDS)
    except RerankerAuthError as exc:
        return RagConnectivityProbeResponse(status="refused", detail=f"凭据被拒（{_probe_detail(str(exc))}）")
    except Exception as exc:  # noqa: BLE001 — same contract as the embedding branch
        logger.warning("connectivity probe failed for rerank/%s", body.provider, exc_info=True)
        return RagConnectivityProbeResponse(status="unreachable", detail=f"未能连通（{type(exc).__name__}）：{_probe_detail(str(exc))}")

    # Say what the admin got, not how the leg is built: "this leg has no dimension question"
    # explains our design, which is not what a hover is for (2026-09-28).
    return RagConnectivityProbeResponse(status="ok", detail="连通正常，重排服务可用。")
