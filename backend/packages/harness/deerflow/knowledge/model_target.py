"""RAG model-target resolution (spec 2026-09-23 default model D3).

Every RAG role has its own declaration in the ``rag:`` block (``extract_model`` /
``judge_model`` / ``vlm_model``) and one RAG-wide default sits behind them. A caller picks
its own role declaration first and passes it in as ``name``; this module answers the half
they all share — the RAG default, else the first configured model.

Deliberately pure and standalone: no SDK construction, no network, no Qdrant, and no read
of the global config singleton unless the caller hands one over. The RAG save path passes
``rag=`` the *pending* block it is about to write, because ``config.rag`` still carries the
file being replaced and would answer for the wrong configuration.

Name lookup is exact: an explicit role name is never replaced by a default (a typo must
reach the factory and raise), and only the RAG default itself may be superseded — with a
warning that names it. A missing model list is not resolved here; the caller reports it.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger(__name__)


def _declared(value: Any) -> str | None:
    """A non-blank string is a declaration; anything else means "not declared" (D2)."""
    if isinstance(value, str) and value.strip():
        return value
    return None


def _field(source: Any, name: str) -> Any:
    """Read one field from either a config object or a plain mapping."""
    if source is None:
        return None
    if isinstance(source, Mapping):
        return source.get(name)
    return getattr(source, name, None)


def _model_names(config: Any) -> list[str]:
    return [name for name in (getattr(model, "name", None) for model in (getattr(config, "models", None) or ())) if isinstance(name, str)]


def resolve_rag_model_name(config: Any, name: str | None = None, *, rag: Any = None) -> str | None:
    """Resolve one RAG role's target to a ``models:`` entry name.

    ``name`` is the caller's own role declaration (already chosen in D3's order). ``rag``
    overrides where the RAG default is read from. Returns ``None`` only when there is no
    model to name at all — the caller turns that into a configuration error rather than
    handing ``None`` to the factory, which would silently fall back to the first model.
    """
    explicit = _declared(name)
    if explicit is not None:
        return explicit

    names = _model_names(config)
    if not names:
        return None

    default = _declared(_field(rag if rag is not None else getattr(config, "rag", None), "default_model"))
    if default is None or default in names:
        return default or names[0]

    logger.warning(
        "RAG default model %r is not a configured model; using the first configured model %r instead.",
        default,
        names[0],
    )
    return names[0]


def require_rag_model_name(config: Any, name: str | None = None, *, rag: Any = None, role: str) -> str:
    """Resolve one RAG role's target, or refuse when there is no model to name.

    ``resolve_rag_model_name`` returns ``None`` so the "who reports this" decision stays with
    the caller; a RAG entry point turns it into a configuration error here rather than
    handing ``None`` to the factory, which would index an empty model list (D3). The error
    type is the RAG layer's one readable-configuration-failure signal, which the gateway
    already maps to a 400.
    """
    resolved = resolve_rag_model_name(config, name, rag=rag)
    if resolved is None:
        from deerflow.knowledge.embedder import RagConfigurationError

        raise RagConfigurationError(f"RAG 未配置可用模型：{role} 需要 config.models 里至少有一个条目，或为 rag.default_model 指定一个。")
    return resolved
