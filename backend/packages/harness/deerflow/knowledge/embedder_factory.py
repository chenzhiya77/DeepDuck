"""Build the configured embedder — dense provider, sparse route, and their wiring (spec §4.2).

Four things are decided here, and they are the reason this is a module rather than a call
to one class:

1. **Who embeds.** ``rag.embedding_provider`` resolves through the curated allowlist (same
   rule as the rerank and parse legs: a caller never supplies a class path).
2. **Who supplies the sparse half.** ``rag.embedding_sparse_source`` picks the provider
   itself, a separate sparse service, or local BM25. When it is not the provider, 甲's
   composition adapter holds both halves and still returns one ``EmbeddingResult`` per text,
   so no caller changes.
3. **Which dimension we are in.** The Qdrant collections are created at 1024 and are not
   recreated on a dimension change (§4.2 维度 #2), so the width must be certified. A provider
   that pins the dimension in its request (DashScope) needs nothing; any other provider is
   measured once per process — reused from the first real embedding, so the certification
   costs no extra round trip — and a non-1024 width is refused with a pointer at the rebuild
   entry, which is the documented way out (§4.2 维度 #4).
4. **Whether the sparse half actually arrived.** ``sparse_source=provider`` trusts the
   allowlist and the model-level probe, but a probe cannot cover every call, so the same
   build wraps the result in a check that refuses an empty sparse vector (D5).
"""

from __future__ import annotations

import logging
from typing import Any

from deerflow.config.app_config import get_app_config
from deerflow.knowledge.embedder import ComposedEmbedder, Embedder, RagConfigurationError, SparseHalfMissingError
from deerflow.knowledge.providers import resolve_provider
from deerflow.knowledge.sparse import BM25SparseEncoder

logger = logging.getLogger(__name__)

#: Every Qdrant collection in this project is created at this width (vector_store §3.3).
COLLECTION_DIMENSION = 1024

#: (provider id, base_url, model) → measured dense width. Process-local on purpose: it
#: certifies *this* deployment's endpoint, and a config change alters the key anyway.
_PROBED_DIMENSIONS: dict[tuple[str, str, str], int] = {}

_REBUILD_HINT = "请改用 1024 维的模型，然后到「设置 → 模型 → 功能模型 → 重建索引」重新嵌入现有切片。"


def dimension_mismatch_message(measured: int) -> str:
    """The one wording for a wrong dense width.

    Two callers refuse on this fact — the once-per-process runtime guard here and the save-time
    probe (``app.gateway.routers.rag_config``) — and they must not word it twice: the admin sees
    the same sentence while editing as the ingest would have shown days later.
    """
    return f"嵌入模型返回 {measured} 维，而向量库集合固定为 {COLLECTION_DIMENSION} 维 ⇒ 拒绝启用。{_REBUILD_HINT}"


class _DimensionCheckedEmbedder:
    """Measure the dense width once per process; refuse anything but ``COLLECTION_DIMENSION``.

    The refusal is a ``ValueError``, never an ``EmbedderError``: ``index_chunks`` treats
    ``EmbedderError`` as a soft, per-batch failure and would otherwise bury a configuration
    mistake as "some chunks failed".
    """

    def __init__(self, inner: Embedder, *, key: tuple[str, str, str]) -> None:
        self._inner = inner
        self._key = key

    @property
    def batch_size(self) -> int:
        return self._inner.batch_size

    async def embed(self, texts, *, text_type: str = "document"):
        results = await self._inner.embed(texts, text_type=text_type)
        if results and self._key not in _PROBED_DIMENSIONS:
            measured = len(results[0].dense)
            _PROBED_DIMENSIONS[self._key] = measured
            logger.info("embedding provider %s measured at %d dimensions", self._key[0], measured)
            if measured != COLLECTION_DIMENSION:
                raise RagConfigurationError(dimension_mismatch_message(measured))
        return results


class _SparseHalfCheckedEmbedder:
    """Refuse a provider that promised the sparse half and returned an empty one.

    Semantically the *opposite* of ``_DimensionCheckedEmbedder``, and deliberately not
    modelled on its once-per-process verdict. That precedent caches **before** it raises
    (``_PROBED_DIMENSIONS[key] = measured`` sits above ``if measured != 1024``), which is
    only safe because a wrong width is refused downstream anyway: Qdrant rejects the write.
    An empty sparse vector is a *legitimate value* — letting it through once means it is
    really stored, and a "judged already" cache would skip the check on every later call,
    i.e. shout once and stay silent forever, which is worse than the silence we started
    with. So the check runs on every embedding and keeps raising while the answer holds.

    The refusal is a ``SparseHalfMissingError`` so the capability probe can read an empty
    sparse half as the model's answer (``unsupported``) rather than as "could not check".
    """

    def __init__(self, inner: Embedder) -> None:
        self._inner = inner

    @property
    def batch_size(self) -> int:
        return self._inner.batch_size

    async def embed(self, texts, *, text_type: str = "document"):
        results = await self._inner.embed(texts, text_type=text_type)
        if results and not results[0].sparse.indices:
            raise SparseHalfMissingError("嵌入 provider 返回了空的稀疏向量 ⇒ embedding_sparse_source 不能是 'provider'；请改为「独立稀疏服务」（external）或「本地 BM25」（bm25）。")
        return results


def build_embedder(config: Any | None = None, *, rag: Any | None = None, client: Any | None = None) -> Embedder:
    """Instantiate the configured embedder (dense + sparse route).

    ``client`` is forwarded to whichever HTTP clients are built (tests and deployments with
    custom transports/proxies pass one); the providers create their own when it is omitted.

    ``rag`` overrides the RAG section for this call. The settings PUT validates a configuration
    it has *not written yet*, so it passes the merge it is about to persist — reusing the live
    ``config.rag`` there would answer for the file being replaced (spec 2026-09-16 §3 D3).

    Raises ``ValueError`` when the configuration cannot describe a usable embedder: a
    dense-only provider paired with ``sparse_source=provider``, a missing sparse endpoint,
    or a declared dimension other than the collection's.
    """
    if config is None:
        config = get_app_config()
    if rag is None:
        rag = config.rag
    provider_id = rag.embedding_provider
    sparse_source = rag.embedding_sparse_source
    spec = resolve_provider("embedding", provider_id)

    if sparse_source == "provider" and not spec.emits_sparse:
        raise RagConfigurationError(f"嵌入 provider {provider_id!r} 只输出稠密向量 ⇒ embedding_sparse_source 不能是 'provider'；请改为「独立稀疏服务」（external）或「本地 BM25」（bm25）。")

    declared = rag.embedding_dimension
    if declared is not None and declared != COLLECTION_DIMENSION:
        raise RagConfigurationError(f"rag.embedding_dimension 声明的 {declared} 维与向量库集合的 {COLLECTION_DIMENSION} 维不符 ⇒ 拒绝启用。{_REBUILD_HINT}")

    dense = _build_dense(spec, rag, declared, client)
    if sparse_source == "provider":
        # The provider was trusted to supply both halves (allowlist + the model-level probe);
        # this is the fallback for the corners the probe could not reach (D5).
        return _SparseHalfCheckedEmbedder(dense)

    sparse = _build_sparse(rag, sparse_source, client)
    return ComposedEmbedder(dense=dense, sparse=sparse)


def _build_dense(spec, rag, declared: int | None, client: Any | None) -> Embedder:
    """Build the dense half. The allowlist row says whether this vendor fixes its own address.

    A stored ``rag.embedding_base_url`` always wins — that is what keeps a workspace-scoped
    DashScope endpoint usable; ``spec.default_endpoint`` is only the fallback for a row whose
    vendor supplies one (the settings UI shows that field read-only for exactly those rows).
    """
    from deerflow.reflection import resolve_variable

    kwargs: dict = {"client": client}
    base_url = (rag.embedding_base_url or "").strip() or spec.default_endpoint
    if not base_url:
        raise RagConfigurationError(f"嵌入 provider {spec.provider_id!r} 需要 rag.embedding_base_url（这一家没有内置地址）")
    kwargs["base_url"] = base_url
    if rag.embedding_model:
        kwargs["model"] = rag.embedding_model
    if rag.embedding_api_key:
        kwargs["api_key"] = rag.embedding_api_key
    if spec.pins_dimension:
        # The width is injected, never inferred by the implementation (spec 2026-09-17 §3 D3):
        # a vendor whose model is born wider than our collections must be *told* the target,
        # and the guard that would catch a wrong width only fires on a real call.
        kwargs["dimension"] = declared if declared is not None else COLLECTION_DIMENSION
    return _guard(resolve_variable(spec.implementation)(**kwargs), spec, rag)


def _guard(embedder: Embedder, spec, rag) -> Embedder:
    """Wrap a provider that cannot self-certify its width in the one-shot probe.

    The judgement comes from the allowlist row, not from the constructed object: a test
    double (or any duck-typed embedder) must not be mistaken for an unverified endpoint.
    """
    if spec.pins_dimension or rag.embedding_dimension is not None:
        return embedder
    return _DimensionCheckedEmbedder(embedder, key=(spec.provider_id, str(rag.embedding_base_url or ""), str(rag.embedding_model or "")))


def _build_sparse(rag, sparse_source: str, client: Any | None) -> Any:
    if sparse_source == "bm25":
        return BM25SparseEncoder()
    spec = resolve_provider("sparse", rag.sparse_provider) if rag.sparse_provider else None
    if spec is None:
        raise RagConfigurationError("embedding_sparse_source='external' 需要 rag.sparse_provider（受控 allowlist）")
    from deerflow.reflection import resolve_variable

    kwargs: dict = {"base_url": rag.sparse_base_url, "client": client}
    if rag.sparse_api_key:
        kwargs["api_key"] = rag.sparse_api_key
    return resolve_variable(spec.implementation)(**kwargs)
