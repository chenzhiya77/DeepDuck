"""Build the configured rerank provider (spec 2026-09-14 §4.1).

Every construction site goes through here on purpose: the online retrieval paths and the
evaluation runner must use the *same* reranker, or an evaluation would grade a different
retriever than the one that serves queries.
"""

from __future__ import annotations

from typing import Any

from deerflow.knowledge.providers import resolve_provider


def build_reranker(config: Any | None = None) -> Any:
    """Instantiate the rerank provider the configuration selects.

    Raises ``ValueError`` when the selected provider needs an endpoint the configuration
    never supplied — only DashScope ships a default address.
    """
    if config is None:
        from deerflow.config.app_config import get_app_config

        config = get_app_config()
    rag = config.rag
    spec = resolve_provider("rerank", rag.rerank_provider)

    endpoint = rag.rerank_base_url or None
    if endpoint is None and spec.provider_id != "dashscope":
        raise ValueError(
            f"rerank_provider={spec.provider_id!r} requires rag.rerank_base_url; only `dashscope` has a built-in endpoint.",
        )

    from deerflow.reflection import resolve_variable

    implementation = resolve_variable(spec.implementation)
    kwargs: dict[str, Any] = {"model": rag.rerank_model}
    if endpoint is not None:
        kwargs["base_url"] = endpoint
    if rag.rerank_api_key:
        kwargs["api_key"] = rag.rerank_api_key
    return implementation(**kwargs)
