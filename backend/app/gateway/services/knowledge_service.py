"""Application service for the knowledge-base API (spec §5.3 / §3.7).

Owns everything between the thin router and the harness layer: upload
persistence (host-side file + ``documents`` row + worker enqueue), cascade
deletes across the three stores (Qdrant → graph → wiki dirty → business
rows), failed-document retry, and fire-and-forget wiki generation.

Cascade ordering rule (mirrors ``KnowledgeStore.delete_kb``'s docstring): the
Qdrant cleanup runs first and its failures are logged but swallowed — a vector
store outage must never strand business rows half-deleted.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.wiki.generator import generate_wiki
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.uploads.manager import normalize_filename
from deerflow.utils.file_io import run_file_io

logger = logging.getLogger(__name__)


class KnowledgeService:
    """Coordinates stores + worker for the knowledge-base endpoints."""

    def __init__(
        self,
        *,
        store: KnowledgeStore,
        vector_store: Any,
        graph_store: GraphStore | None = None,
        wiki_store: WikiStore | None = None,
        worker: Any = None,
        data_dir: str | Path,
        wiki_generate_fn: Callable[[str], None] | None = None,
    ) -> None:
        self.store = store
        self.vector_store = vector_store
        self.graph_store = graph_store or GraphStore(store._sf)
        self.wiki_store = wiki_store or WikiStore(store._sf)
        self.worker = worker
        self.data_dir = Path(data_dir)
        self.wiki_generate_fn = wiki_generate_fn or self._schedule_wiki_generation
        self._wiki_tasks: set[asyncio.Task[None]] = set()

    # ── documents ────────────────────────────────────────────────────────

    async def upload_document(self, *, kb_id: str, uploader_id: str, filename: str, content: bytes) -> dict[str, Any]:
        """Persist the file, create the ``uploaded`` row, enqueue indexing."""
        doc_id = uuid.uuid4().hex
        safe_name = normalize_filename(filename or "document")
        doc_dir = self.data_dir / "knowledge" / kb_id / doc_id
        dest = doc_dir / safe_name

        def _write() -> None:
            doc_dir.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)

        await run_file_io(_write)
        document = await self.store.create_document(
            doc_id=doc_id,
            kb_id=kb_id,
            uploader_id=uploader_id,
            name=safe_name,
            size_bytes=len(content),
            storage_path=str(dest),
        )
        if self.worker is not None:
            await self.worker.submit(doc_id)
        return document

    async def delete_document_cascade(self, *, kb_id: str, doc_id: str) -> bool:
        """Delete one document across vector/graph/wiki/business stores."""
        document = await self.store.get_document(doc_id)
        if document is None or document["kb_id"] != kb_id:
            return False
        chunks = await self.store.list_chunks(doc_id, limit=1_000_000)
        chunk_ids = [chunk["chunk_id"] for chunk in chunks]
        try:
            await self.vector_store.delete_by_doc(doc_id)
        except Exception:
            logger.exception("qdrant delete_by_doc failed for %s; continuing business-row cleanup", doc_id)
        orphaned, affected = await self.graph_store.remove_chunk_contributions(kb_id, chunk_ids)
        if orphaned:
            try:
                await self.vector_store.delete_entities(kb_id, orphaned)
            except Exception:
                logger.exception("qdrant delete_entities failed for %s orphans", doc_id)
        if affected:
            await self.wiki_store.mark_dirty_for_titles(kb_id, affected)
        await self.store.delete_document(doc_id)
        await self._remove_dir(self.data_dir / "knowledge" / kb_id / doc_id)
        return True

    async def retry_document(self, *, kb_id: str, doc_id: str) -> dict[str, Any] | None:
        """Wipe a failed document's derived state and re-enqueue indexing."""
        document = await self.store.get_document(doc_id)
        if document is None or document["kb_id"] != kb_id:
            return None
        chunks = await self.store.list_chunks(doc_id, limit=1_000_000)
        chunk_ids = [chunk["chunk_id"] for chunk in chunks]
        if chunk_ids:
            try:
                await self.vector_store.delete_by_doc(doc_id)
            except Exception:
                logger.exception("qdrant delete_by_doc failed during retry of %s", doc_id)
            orphaned, affected = await self.graph_store.remove_chunk_contributions(kb_id, chunk_ids)
            if orphaned:
                try:
                    await self.vector_store.delete_entities(kb_id, orphaned)
                except Exception:
                    logger.exception("qdrant delete_entities failed during retry of %s", doc_id)
            if affected:
                await self.wiki_store.mark_dirty_for_titles(kb_id, affected)
            await self.store.delete_chunks_by_doc(doc_id)
        reset = await self.store.reset_document_for_retry(doc_id)
        if self.worker is not None:
            await self.worker.submit(doc_id)
        return reset

    # ── knowledge base ───────────────────────────────────────────────────

    async def delete_kb_cascade(self, *, kb_id: str) -> bool:
        """Delete the whole KB: three Qdrant collections + all business rows."""
        try:
            await self.vector_store.delete_by_kb(kb_id)
        except Exception:
            logger.exception("qdrant delete_by_kb failed for %s; continuing business-row cleanup", kb_id)
        deleted = await self.store.delete_kb(kb_id)
        if deleted:
            await self._remove_dir(self.data_dir / "knowledge" / kb_id)
        return deleted

    # ── wiki ─────────────────────────────────────────────────────────────

    def trigger_wiki_generation(self, kb_id: str) -> None:
        """Fire-and-forget wiki batch generation (manual "生成百科" button)."""
        self.wiki_generate_fn(kb_id)

    def _schedule_wiki_generation(self, kb_id: str) -> None:
        task = asyncio.create_task(self._run_wiki_generation(kb_id), name=f"kb-wiki-{kb_id}")
        self._wiki_tasks.add(task)
        task.add_done_callback(self._wiki_tasks.discard)

    async def _run_wiki_generation(self, kb_id: str) -> None:
        try:
            await generate_wiki(self.store, self.graph_store, self.wiki_store, self.vector_store, kb_id=kb_id)
        except Exception:
            logger.exception("wiki generation failed for kb %s", kb_id)

    # ── internals ────────────────────────────────────────────────────────

    async def _remove_dir(self, path: Path) -> None:
        def _rm() -> None:
            shutil.rmtree(path, ignore_errors=True)

        try:
            await run_file_io(_rm)
        except Exception:
            logger.warning("failed to remove knowledge dir %s", path, exc_info=True)
