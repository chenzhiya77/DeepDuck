"""Graph indexing stage: per-chunk extract → normalize → store → backfill.

Orchestrates the graph leg of the pipeline (spec §3.4): each ``pending``
chunk is extracted independently (slice = minimal unit, status persisted for
resume), normalized, merged into the graph store, then its normalized entity
names are written back to the chunk row and the ``kb_chunks`` Qdrant payload
(the reverse half of the graph↔vector link). Touched entities are re-embedded
into ``kb_entities`` so ``graph_search`` can match them. A document whose
failure rate exceeds 30% gets the "graph degraded" flag on its ``error``
field — visible on the document list, never a silently-incomplete graph.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

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
    """Outcome of one document's graph indexing run (this invocation only)."""

    total: int
    done: int = 0
    empty: int = 0
    failed_chunk_ids: list[str] = field(default_factory=list)
    degraded: bool = False


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
) -> GraphIndexStats:
    """Run graph extraction over a document's pending chunks.

    Only ``pending`` chunks are processed — ``done``/``empty``/``failed`` rows
    are left untouched, so a restarted worker resumes without re-extracting
    (spec §3.7 启动恢复).
    """
    pending = [chunk for chunk in chunks if chunk.get("extract_status", "pending") == "pending"]
    stats = GraphIndexStats(total=len(pending))
    if not pending:
        return stats

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
            continue
        if not result.entities and not result.relations:
            await store.update_chunk_extract(chunk_id, "empty")
            stats.empty += 1
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

    # Reverse link: normalized names onto the kb_chunks payload.
    if vector_store is not None and backfill:
        await vector_store.set_chunk_entities(backfill)

    # Entity vectors: name+description dense embeddings into kb_entities, so
    # the online graph_search can match query entities (spec §3.4 storage).
    if vector_store is not None and embedder is not None and touched_entities:
        rows = await graph_store.list_entities(kb_id)
        targets = [row for row in rows if row["name"] in touched_entities]
        if targets:
            embeddings = await embedder.embed([f"{row['name']}\n{row.get('description') or ''}" for row in targets])
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
        document = await store.get_document(doc_id)
        if document is not None:
            await store.update_document_status(
                doc_id,
                document["status"],
                error=f"graph degraded: {len(stats.failed_chunk_ids)}/{stats.total} chunks failed extraction",
            )
    return stats
