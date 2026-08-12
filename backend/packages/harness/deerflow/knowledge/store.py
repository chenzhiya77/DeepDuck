"""CRUD store over the RAG knowledge-base business tables.

Holds the source of truth for chunk text and the per-chunk extract state
machine; Qdrant only mirrors vectors + a ``chunk_id`` pointer (spec §3.2).
Graph/wiki-specific writers land with their own indexers (Tasks 5/6); this
store owns the shared lifecycle: KBs, documents, chunks, and cascading
deletes across all six tables.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from deerflow.knowledge.models import (
    ChunkRow,
    DocumentRow,
    GraphEntityRow,
    GraphRelationRow,
    KnowledgeBaseRow,
    WikiEntryRow,
)
from deerflow.utils.time import coerce_iso

#: Document status machine (spec §3.6): uploaded → parsing → chunking →
#: indexing → ready / failed.
DOCUMENT_STATUSES: frozenset[str] = frozenset({"uploaded", "parsing", "chunking", "indexing", "ready", "failed"})

#: Per-chunk graph-extract states (spec §3.4); persisted for resume.
CHUNK_EXTRACT_STATUSES: frozenset[str] = frozenset({"pending", "done", "empty", "failed"})


class KnowledgeStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._sf = session_factory

    @staticmethod
    def _row_to_dict(row: Any, *, datetime_keys: tuple[str, ...] = ("created_at", "updated_at")) -> dict[str, Any]:
        data = row.to_dict()
        for key in datetime_keys:
            if data.get(key) is not None:
                data[key] = coerce_iso(data[key])
        return data

    # ── knowledge_bases ──────────────────────────────────────────────────

    async def create_kb(
        self,
        *,
        kb_id: str,
        owner_id: str,
        name: str,
        description: str | None = None,
        visibility: str = "private",
    ) -> dict[str, Any]:
        row = KnowledgeBaseRow(
            id=kb_id,
            owner_id=owner_id,
            name=name,
            description=description,
            visibility=visibility,
            created_at=datetime.now(UTC),
        )
        async with self._sf() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def get_kb(self, kb_id: str) -> dict[str, Any] | None:
        async with self._sf() as session:
            row = await session.get(KnowledgeBaseRow, kb_id)
            return None if row is None else self._row_to_dict(row)

    async def list_kbs(self, owner_id: str) -> list[dict[str, Any]]:
        stmt = select(KnowledgeBaseRow).where(KnowledgeBaseRow.owner_id == owner_id).order_by(KnowledgeBaseRow.created_at.desc(), KnowledgeBaseRow.id.desc())
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [self._row_to_dict(row) for row in result.scalars().all()]

    async def update_kb(self, kb_id: str, *, name: str | None = None, description: str | None = None) -> dict[str, Any] | None:
        """Rename / re-describe a KB; ``None`` leaves a field unchanged."""
        async with self._sf() as session:
            row = await session.get(KnowledgeBaseRow, kb_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if description is not None:
                row.description = description
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def delete_kb(self, kb_id: str) -> bool:
        """Delete a KB and cascade across all six business tables.

        Vector-side cleanup (three Qdrant collections) is layered on top by
        the API/worker so a vector failure cannot strand business rows
        half-deleted (spec §3.7).
        """
        async with self._sf() as session:
            row = await session.get(KnowledgeBaseRow, kb_id)
            if row is None:
                return False
            for model in (ChunkRow, DocumentRow, GraphEntityRow, GraphRelationRow, WikiEntryRow):
                await session.execute(delete(model).where(model.kb_id == kb_id))
            await session.delete(row)
            await session.commit()
            return True

    # ── documents ────────────────────────────────────────────────────────

    async def create_document(
        self,
        *,
        doc_id: str,
        kb_id: str,
        uploader_id: str,
        name: str,
        size_bytes: int,
        storage_path: str,
    ) -> dict[str, Any]:
        row = DocumentRow(
            id=doc_id,
            kb_id=kb_id,
            uploader_id=uploader_id,
            name=name,
            size_bytes=size_bytes,
            storage_path=storage_path,
            status="uploaded",
            progress_percent=0,
            created_at=datetime.now(UTC),
        )
        async with self._sf() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        async with self._sf() as session:
            row = await session.get(DocumentRow, doc_id)
            return None if row is None else self._row_to_dict(row)

    async def list_documents(self, kb_id: str) -> list[dict[str, Any]]:
        stmt = select(DocumentRow).where(DocumentRow.kb_id == kb_id).order_by(DocumentRow.created_at.desc(), DocumentRow.id.desc())
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [self._row_to_dict(row) for row in result.scalars().all()]

    async def list_non_terminal_documents(self) -> list[dict[str, Any]]:
        """Documents not in a terminal state — the worker re-enqueues these on startup (spec §3.7 启动恢复)."""
        stmt = select(DocumentRow).where(DocumentRow.status.not_in(("ready", "failed"))).order_by(DocumentRow.created_at, DocumentRow.id)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [self._row_to_dict(row) for row in result.scalars().all()]

    async def update_document_status(
        self,
        doc_id: str,
        status: str,
        *,
        progress_percent: int | None = None,
        chunk_count: int | None = None,
        error: str | None = None,
        path_status: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        """Advance the document status machine; ``None`` leaves a field unchanged.

        ``path_status`` merges **partially** (spec 2026-08-11 §5): only the
        keys passed on this call are updated — the other paths' sub-states
        persist untouched. A wholesale overwrite would violate the contract.
        """
        async with self._sf() as session:
            row = await session.get(DocumentRow, doc_id)
            if row is None:
                return None
            row.status = status
            if progress_percent is not None:
                row.progress_percent = progress_percent
            if chunk_count is not None:
                row.chunk_count = chunk_count
            if error is not None:
                row.error = error
            if path_status is not None:
                merged = dict(row.path_status or {})
                merged.update(path_status)
                row.path_status = merged
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def reset_document_for_retry(self, doc_id: str) -> dict[str, Any] | None:
        """Reset a failed document to ``uploaded`` for re-indexing: clears progress,
        chunk count, and the error (unlike ``update_document_status`` whose ``None``
        means \"leave unchanged\"). The per-path sub-status is cleared too — the
        re-run rebuilds it from scratch (spec 2026-08-11 §5)."""
        async with self._sf() as session:
            row = await session.get(DocumentRow, doc_id)
            if row is None:
                return None
            row.status = "uploaded"
            row.progress_percent = 0
            row.chunk_count = None
            row.error = None
            row.path_status = None
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def delete_document(self, doc_id: str) -> bool:
        async with self._sf() as session:
            row = await session.get(DocumentRow, doc_id)
            if row is None:
                return False
            await session.execute(delete(ChunkRow).where(ChunkRow.doc_id == doc_id))
            await session.delete(row)
            await session.commit()
            return True

    # ── chunks ───────────────────────────────────────────────────────────

    async def insert_chunks(self, chunks: list[dict[str, Any]]) -> int:
        """Bulk-insert freshly chunked rows; extract state starts at ``pending``."""
        rows = [
            ChunkRow(
                chunk_id=chunk["chunk_id"],
                doc_id=chunk["doc_id"],
                kb_id=chunk["kb_id"],
                chunk_index=chunk["chunk_index"],
                text=chunk["text"],
                heading_path=chunk.get("heading_path") or [],
                page=chunk.get("page"),
                token_count=chunk.get("token_count", 0),
                entities=chunk.get("entities") or [],
                extract_status=chunk.get("extract_status", "pending"),
                extract_error=chunk.get("extract_error"),
            )
            for chunk in chunks
        ]
        async with self._sf() as session:
            session.add_all(rows)
            await session.commit()
            return len(rows)

    async def list_chunks(self, doc_id: str, *, offset: int = 0, limit: int = 50) -> list[dict[str, Any]]:
        stmt = select(ChunkRow).where(ChunkRow.doc_id == doc_id).order_by(ChunkRow.chunk_index).offset(offset).limit(limit)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [self._row_to_dict(row, datetime_keys=()) for row in result.scalars().all()]

    async def count_chunks(self, doc_id: str) -> int:
        from sqlalchemy import func

        stmt = select(func.count()).select_from(ChunkRow).where(ChunkRow.doc_id == doc_id)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return int(result.scalar_one())

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[dict[str, Any]]:
        """Fetch chunk rows by id (graph/wiki aggregation of source_chunk_ids)."""
        if not chunk_ids:
            return []
        stmt = select(ChunkRow).where(ChunkRow.chunk_id.in_(chunk_ids))
        async with self._sf() as session:
            result = await session.execute(stmt)
            rows = {row.chunk_id: self._row_to_dict(row, datetime_keys=()) for row in result.scalars().all()}
        return [rows[chunk_id] for chunk_id in chunk_ids if chunk_id in rows]

    async def rewrite_chunk_entities(self, chunk_ids: Sequence[str], name_map: Mapping[str, str]) -> int:
        """Rewrite the ``entities`` column on chunk rows through ``name_map``
        (spec 2026-08-10 D3 dual-write, business-DB half — the Qdrant payload
        half goes through ``set_chunk_entities``; both mirrors must move
        together). Returns the number of rows actually changed. Idempotent.
        """
        if not chunk_ids or not name_map:
            return 0
        changed = 0
        async with self._sf() as session:
            result = await session.execute(select(ChunkRow).where(ChunkRow.chunk_id.in_(list(chunk_ids))))
            for row in result.scalars().all():
                current = list(row.entities or [])
                rewritten: list[str] = []
                for name in current:
                    mapped = name_map.get(name, name)
                    if mapped not in rewritten:
                        rewritten.append(mapped)
                if rewritten != current:
                    row.entities = rewritten
                    changed += 1
            await session.commit()
        return changed

    async def update_chunk_extract(
        self,
        chunk_id: str,
        status: str,
        *,
        entities: list[str] | None = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        """Persist a per-chunk extract transition (pending → done/empty/failed).

        ``entities`` carries the normalized-name backfill on ``done`` (spec §3.4).
        """
        async with self._sf() as session:
            row = await session.get(ChunkRow, chunk_id)
            if row is None:
                return None
            row.extract_status = status
            if entities is not None:
                row.entities = entities
            if error is not None:
                row.extract_error = error
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row, datetime_keys=())

    async def delete_chunks_by_doc(self, doc_id: str) -> int:
        """Drop one document's chunk rows (re-parse / retry wipe; spec §3.7)."""
        async with self._sf() as session:
            result = await session.execute(delete(ChunkRow).where(ChunkRow.doc_id == doc_id))
            await session.commit()
            return int(result.rowcount or 0)

    async def delete_chunks_by_kb(self, kb_id: str) -> int:
        async with self._sf() as session:
            result = await session.execute(delete(ChunkRow).where(ChunkRow.kb_id == kb_id))
            await session.commit()
            return int(result.rowcount or 0)


def get_knowledge_store() -> KnowledgeStore:
    """Build the store from the globally-initialized persistence engine."""
    from deerflow.persistence.engine import get_session_factory

    session_factory = get_session_factory()
    if session_factory is None:
        raise RuntimeError("persistence engine is not initialized")
    return KnowledgeStore(session_factory)
