"""The same-width half of an embedding change: hold the model fields, re-embed
every library in place, flip the configuration when the rebuild reports success.

``rag_migration`` owns the width half — a width change rebuilds into a *fresh*
generation and flips once, atomically. Same-width cannot reuse it: the
collections keep their names, so the rebuild overwrites them in place
(``reindex_kb`` is re-embed only, never re-parse). The configuration must keep
pointing at the *old* model while that happens — otherwise every query in the
switch window compares new-model questions against old-model vectors, the exact
poisoning this pair exists to remove (spec 2026-10-04 D3).

The order is the whole point, as in the width channel: the file still says the
old model until every library is re-embedded, so a failure here is "nothing
happened" — the file is only replaced after a complete rebuild and the old
vectors keep serving. One known bound of the in-place mechanism: mid-run the
collection is partially re-embedded, so the window sees a transient mix; the
hold keeps the query side on the old model throughout, and the flip waits for
the end state.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from deerflow.config.rag_config_file import write_rag_config
from deerflow.knowledge.reindex import reindex_kb

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _Run:
    """One rebuild's live verdict: where it is, what it targets, and if it died, why."""

    target_provider: str | None = None
    target_model: str | None = None
    target_base_url: str | None = None
    state: str = "running"
    detail: str | None = None


_STATE: _Run | None = None
_TASKS: set[asyncio.Task[None]] = set()


def reembed_running() -> bool:
    return _STATE is not None and _STATE.state == "running"


def reembed_status() -> dict[str, Any] | None:
    """The status payload the settings page polls; ``None`` when nothing ever ran.

    The ``target_*`` trio mirrors the withheld fields — what the flip writes once the
    rebuild reports success. The credential is withheld too but never echoed here.
    """
    if _STATE is None:
        return None
    return {
        "state": _STATE.state,
        "detail": _STATE.detail,
        "target_provider": _STATE.target_provider,
        "target_model": _STATE.target_model,
        "target_base_url": _STATE.target_base_url,
    }


def reset_state() -> None:
    """Forget the last verdict (deployments and tests both need a clean slate)."""
    global _STATE
    _STATE = None


def start_reembed(
    *,
    store: Any,
    graph_store: Any,
    wiki_store: Any,
    vector_store: Any,
    embedder: Any,
    target_payload: dict[str, Any],
) -> None:
    """Kick the rebuild off the request path; the flip happens inside the task.

    ``target_payload`` is the configuration this save would have put in force
    immediately: the caller already wrote everything *withheld* (the embedding
    identity — model, endpoint, credential — stays at its old values), so this is
    the whole object, not a patch.
    """
    global _STATE
    if reembed_running():
        raise RuntimeError("an embedding rebuild is already running")
    _STATE = _Run(
        target_provider=target_payload.get("embedding_provider"),
        target_model=target_payload.get("embedding_model"),
        target_base_url=target_payload.get("embedding_base_url"),
    )
    spec = (store, graph_store, wiki_store, vector_store, embedder, target_payload)
    task = asyncio.create_task(_run(*spec), name="embedding-reembed")
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def reembed_libraries(
    store: Any,
    *,
    vector_store: Any,
    embedder: Any,
    graph_store: Any,
    wiki_store: Any,
) -> int:
    """Re-embed every library in place; returns how many libraries were walked.

    The rebuild's heavy end, kept module-level so tests can patch it. Per-library
    reindex already refuses to sink the run on one document; a raise here means
    something library-wide broke and the caller must not flip.
    """
    kbs = await store.list_all_kbs()
    for kb in kbs:
        await reindex_kb(store, vector_store, embedder, kb_id=kb["id"], graph_store=graph_store, wiki_store=wiki_store)
    return len(kbs)


async def _run(
    store: Any,
    graph_store: Any,
    wiki_store: Any,
    vector_store: Any,
    embedder: Any,
    target_payload: dict[str, Any],
) -> None:
    assert _STATE is not None  # set by start_reembed before the task was scheduled
    state = _STATE
    try:
        kbs = await reembed_libraries(store, vector_store=vector_store, embedder=embedder, graph_store=graph_store, wiki_store=wiki_store)
    except Exception as exc:
        state.state = "failed"
        state.detail = f"{type(exc).__name__}: {exc}"
        logger.exception("embedding rebuild failed; the config and the stored vectors are untouched")
        return

    # The switch: one atomic replace, and only here — after a complete rebuild.
    await asyncio.to_thread(write_rag_config, dict(target_payload))
    state.state = "succeeded"
    logger.info("embedding rebuild complete for %d libraries; rag_config.json now declares the new model", kbs)
