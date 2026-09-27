"""Graph indexing stage: per-chunk extract → normalize → store → backfill.

Orchestrates the graph leg of the pipeline (spec §3.4): each ``pending``
chunk is extracted independently (slice = minimal unit, status persisted for
resume), normalized, merged into the graph store, then its normalized entity
names are written back to the chunk row and the ``kb_chunks`` Qdrant payload
(the reverse half of the graph↔vector link). Touched entities are re-embedded
into ``kb_entities`` so ``graph_search`` can match them. A document whose
failure rate exceeds 30% is reported as ``stats.degraded`` — the *marker* it
produces is the worker's to write (spec 2026-09-23 D8/R8: appending keeps a
degraded caption verdict instead of overwriting it), so this stage never
touches ``documents.error``.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from deerflow.knowledge.embed_texts import entity_embed_text
from deerflow.knowledge.embedder import EmbeddingResult
from deerflow.knowledge.graph.extractor import ExtractionError, extract_graph
from deerflow.knowledge.graph.normalizer import normalize_extraction
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.vector_store import EntityUpsert, KnowledgeVectorStore

logger = logging.getLogger(__name__)

#: Doc-level "graph degraded" threshold (spec §3.4): over 30% failed chunks.
DEGRADED_FAILURE_THRESHOLD = 0.3


class _LLM(Protocol):
    async def ainvoke(self, messages: Any) -> Any: ...


class _Embedder(Protocol):
    batch_size: int

    async def embed(self, texts: Sequence[str], *, text_type: str = "document") -> list[EmbeddingResult]: ...


@dataclass(slots=True)
class GraphIndexStats:
    """Outcome of one document's graph indexing run (this invocation only).

    ``touched_entities`` feeds the D3 incremental re-resolution: the worker
    triggers it after this stage with exactly the entities this run wrote.
    """

    total: int
    done: int = 0
    empty: int = 0
    failed_chunk_ids: list[str] = field(default_factory=list)
    degraded: bool = False
    touched_entities: set[str] = field(default_factory=set)


async def extract_single_chunk(
    store: KnowledgeStore,
    graph_store: GraphStore,
    *,
    kb_id: str,
    chunk_id: str,
    text: str,
    llm: _LLM | None = None,
    embedder: _Embedder | None = None,
    gleaning_rounds: int = 1,
    name_similarity_threshold: float = 0.92,
) -> list[str]:
    """Extract entities/relations from ONE chunk's text and persist them (Phase-3 Batch-1 P3).

    Mirrors the per-chunk body of ``index_document_graph`` but for a single,
    caller-specified chunk — used by the re-extract endpoint which must NOT
    re-parse the source file (that would clobber manual text edits).

    Returns the normalized entity names written back to ``chunks.entities``
    (empty list when the extraction yielded nothing).
    """
    try:
        result = await extract_graph(text, llm=llm, gleaning_rounds=gleaning_rounds)
    except ExtractionError as exc:
        logger.warning("graph extraction failed for chunk %s: %s", chunk_id, exc)
        await store.update_chunk_extract(chunk_id, "failed", error=str(exc))
        raise
    if not result.entities and not result.relations:
        await store.update_chunk_extract(chunk_id, "empty", entities=[])
        return []

    name_vectors = None
    if embedder is not None and result.entities:
        vectors = await embedder.embed([entity.name for entity in result.entities])
        name_vectors = {entity.name: embedding.dense for entity, embedding in zip(result.entities, vectors, strict=True)}
    result = normalize_extraction(result, name_vectors=name_vectors, similarity_threshold=name_similarity_threshold)

    await graph_store.upsert_entities(kb_id, result.entities, chunk_id=chunk_id)
    await graph_store.upsert_relations(kb_id, result.relations, chunk_id=chunk_id)
    names = [entity.name for entity in result.entities]
    await store.update_chunk_extract(chunk_id, "done", entities=names)
    return names


async def index_document_graph(
    store: KnowledgeStore,
    graph_store: GraphStore,
    vector_store: KnowledgeVectorStore | None = None,
    *,
    kb_id: str,
    doc_id: str,
    chunks: Sequence[dict[str, Any]],
    llm: _LLM | None = None,
    embedder: _Embedder | None = None,
    gleaning_rounds: int = 1,
    name_similarity_threshold: float = 0.92,
    progress_callback: Callable[[int, int], Awaitable[None]] | None = None,
) -> GraphIndexStats:
    """Run graph extraction over a document's pending chunks.

    Only ``pending`` chunks are processed — ``done``/``empty``/``failed`` rows
    are left untouched, so a restarted worker resumes without re-extracting
    (spec §3.7 启动恢复).

    ``progress_callback`` (when given) fires after every settled chunk with
    ``(settled, total)`` in whole-document units: ``settled`` counts chunks in
    any resolved extract state (done/empty/failed, including pre-existing
    ones), so the worker can persist ``documents.progress_percent`` (spec §3.6
    进度口径：图谱路为全流水线最慢阶段，近似整体进度).
    """
    pending = [chunk for chunk in chunks if chunk.get("extract_status", "pending") == "pending"]
    stats = GraphIndexStats(total=len(pending))
    if not pending:
        return stats

    total_all = len(chunks)
    settled = sum(1 for chunk in chunks if chunk.get("extract_status") in ("done", "empty", "failed"))

    async def _report() -> None:
        if progress_callback is not None:
            await progress_callback(settled, total_all)

    touched_entities: set[str] = set()
    backfill: dict[str, list[str]] = {}
    for chunk in pending:
        chunk_id = chunk["chunk_id"]
        try:
            result = await extract_graph(chunk["text"], llm=llm, gleaning_rounds=gleaning_rounds)
        except ExtractionError as exc:
            logger.warning("graph extraction failed for chunk %s: %s", chunk_id, exc)
            await store.update_chunk_extract(chunk_id, "failed", error=str(exc))
            stats.failed_chunk_ids.append(chunk_id)
            settled += 1
            await _report()
            continue
        if not result.entities and not result.relations:
            await store.update_chunk_extract(chunk_id, "empty")
            stats.empty += 1
            settled += 1
            await _report()
            continue

        name_vectors = None
        if embedder is not None and result.entities:
            vectors = await embedder.embed([entity.name for entity in result.entities])
            name_vectors = {entity.name: embedding.dense for entity, embedding in zip(result.entities, vectors, strict=True)}
        result = normalize_extraction(result, name_vectors=name_vectors, similarity_threshold=name_similarity_threshold)

        await graph_store.upsert_entities(kb_id, result.entities, chunk_id=chunk_id)
        await graph_store.upsert_relations(kb_id, result.relations, chunk_id=chunk_id)
        names = [entity.name for entity in result.entities]
        await store.update_chunk_extract(chunk_id, "done", entities=names)
        backfill[chunk_id] = names
        touched_entities.update(names)
        stats.done += 1
        settled += 1
        await _report()

    # Reverse link: normalized names onto the kb_chunks payload.
    if vector_store is not None and backfill:
        await vector_store.set_chunk_entities(backfill)

    # Entity vectors: name+description dense embeddings into kb_entities, so
    # the online graph_search can match query entities (spec §3.4 storage).
    if vector_store is not None and embedder is not None and touched_entities:
        rows = await graph_store.list_entities(kb_id)
        targets = [row for row in rows if row["name"] in touched_entities]
        if targets:
            embeddings = await embedder.embed([entity_embed_text(row["name"], row.get("description")) for row in targets])
            await vector_store.upsert_entities(
                [
                    EntityUpsert(
                        name=row["name"],
                        kb_id=kb_id,
                        type=row.get("type") or "",
                        description=row.get("description") or "",
                        dense=embedding.dense,
                    )
                    for row, embedding in zip(targets, embeddings, strict=True)
                ]
            )

    if stats.total and len(stats.failed_chunk_ids) / stats.total > DEGRADED_FAILURE_THRESHOLD:
        stats.degraded = True
    stats.touched_entities = touched_entities
    return stats
