"""Curated provider allowlist for the three pluggable RAG legs (spec 2026-09-14 §4.1).

Embedding, rerank, and document parsing are not LangChain models, so they cannot
reuse the ``models:`` entry mechanism (see spec §3.0 / §4.1). They pick their
provider by a **curated id** instead: the admin API submits the id, and this table
maps it to the implementation, the endpoint key, and the secret's environment
fallback. Same shape as :data:`deerflow.config.models_config.PROVIDER_ALLOWLIST`,
and the same reason — accepting a free-text class path here would be a
dynamic-import surface on par with ``plugins:``.

Implementations are stored as strings so this module stays import-light: the
provider classes arrive with their own tasks (P1 rerank, P2 parse, P3 embedding),
and nothing here imports them eagerly.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProviderSpec:
    """One allowlisted provider: what to build, where to point it, how to authenticate."""

    leg: str
    provider_id: str
    #: ``module.path:ClassName`` — resolved lazily by the leg that owns it.
    implementation: str
    #: Which field of the target names the endpoint (mirrors the model-provider
    #: convention: OpenAI-compatible and Anthropic clients take ``base_url``).
    endpoint_key: str = "base_url"
    #: Request path, when the provider's shape is fixed.
    path: str | None = None
    #: Environment variable backing this provider's secret, or ``None`` when it needs none.
    secret_env_var: str | None = None
    #: Whether one call returns dense *and* sparse. Only such a provider may be paired
    #: with ``embedding_sparse_source=provider`` (spec §4.2 cross-check).
    emits_sparse: bool = False


#: leg -> provider id -> spec. Adding a provider means adding a row here, never
#: accepting an id from the caller that is not in the table.
PROVIDER_ALLOWLIST: dict[str, dict[str, ProviderSpec]] = {
    "embedding": {
        "dashscope": ProviderSpec(
            leg="embedding",
            provider_id="dashscope",
            implementation="deerflow.knowledge.embedder:DashScopeEmbedder",
            path="/api/v1/services/embeddings/text-embedding/text-embedding",
            secret_env_var="DASHSCOPE_EMBEDDING_API_KEY",
            emits_sparse=True,
        ),
        "openai-compatible": ProviderSpec(
            leg="embedding",
            provider_id="openai-compatible",
            implementation="deerflow.knowledge.embedder_openai:OpenAICompatibleEmbedder",
            path="/v1/embeddings",
            secret_env_var="RAG_EMBEDDING_API_KEY",
        ),
    },
    "rerank": {
        "dashscope": ProviderSpec(
            leg="rerank",
            provider_id="dashscope",
            implementation="deerflow.knowledge.reranker:DashScopeReranker",
            path="/compatible-api/v1/reranks",
            secret_env_var="DASHSCOPE_RERANK_API_KEY",
        ),
        "generic-rerank": ProviderSpec(
            leg="rerank",
            provider_id="generic-rerank",
            implementation="deerflow.knowledge.reranker_generic:GenericReranker",
            path="/rerank",
            secret_env_var="RAG_RERANK_API_KEY",
        ),
    },
    "parse": {
        "mineru-cloud": ProviderSpec(
            leg="parse",
            provider_id="mineru-cloud",
            implementation="deerflow.knowledge.parser:MineruCloudParseProvider",
            path="/api/v4",
            secret_env_var="MINERU_API_TOKEN",
        ),
        "mineru-local": ProviderSpec(
            leg="parse",
            provider_id="mineru-local",
            implementation="deerflow.knowledge.parse_local:MineruLocalParseProvider",
            path="/file_parse",
            # The local MinerU service ships without auth (spec §8.2), so there is no
            # environment fallback to fall back to.
            secret_env_var=None,
        ),
    },
    # Not a leg of its own in the retrieval sense — this is the *second* endpoint a
    # deployment may point at when `embedding_sparse_source=external`, i.e. a service
    # that returns sparse vectors only. Its request shape is not pinned yet (path=None);
    # the client that consumes it lands with P3.
    "sparse": {
        "openai-compatible": ProviderSpec(
            leg="sparse",
            provider_id="openai-compatible",
            implementation="deerflow.knowledge.sparse:OpenAICompatibleSparseEncoder",
            path=None,
            secret_env_var="RAG_SPARSE_API_KEY",
        ),
    },
}


def provider_ids(leg: str) -> tuple[str, ...]:
    """The allowlisted ids for *leg*, in declaration order (the UI renders these)."""
    if leg not in PROVIDER_ALLOWLIST:
        raise ValueError(f"Unknown RAG provider leg {leg!r}; expected one of {sorted(PROVIDER_ALLOWLIST)}")
    return tuple(PROVIDER_ALLOWLIST[leg])


def resolve_provider(leg: str, provider_id: str) -> ProviderSpec:
    """Resolve *provider_id* for *leg*, refusing anything outside the allowlist."""
    if leg not in PROVIDER_ALLOWLIST:
        raise ValueError(f"Unknown RAG provider leg {leg!r}; expected one of {sorted(PROVIDER_ALLOWLIST)}")
    spec = PROVIDER_ALLOWLIST[leg].get(provider_id)
    if spec is None:
        raise ValueError(f"Unknown {leg} provider {provider_id!r}; expected one of {provider_ids(leg)}")
    return spec


def secret_env_var(leg: str, provider_id: str) -> str | None:
    """The environment variable backing this provider's secret, or ``None`` if it needs none."""
    return resolve_provider(leg, provider_id).secret_env_var
