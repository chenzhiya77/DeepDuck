"""Application service for the knowledge-base API (spec §5.3 / §3.7).

Owns everything between the thin router and the harness layer: upload
persistence (host-side file + ``documents`` row + worker enqueue), cascade
deletes across the three stores (Qdrant → graph → wiki lifecycle → business
rows), failed-document retry, and fire-and-forget wiki generation.

Cascade ordering rule (mirrors ``KnowledgeStore.delete_kb``'s docstring): the
Qdrant cleanup runs first and its failures are logged but swallowed — a vector
store outage must never strand business rows half-deleted.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
import uuid
from collections.abc import Callable, Collection
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from deerflow.knowledge.graph.indexer import extract_single_chunk
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.parser import SUPPORTED_UPLOAD_SUFFIXES, is_supported_suffix
from deerflow.knowledge.reranker import DashScopeReranker
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.wiki.generator import generate_wiki, wiki_generation_in_progress, wiki_last_run_status
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.tools.builtins.graph_search_tool import _graph_search_impl
from deerflow.tools.builtins.hybrid_search_tool import _hybrid_search_impl
from deerflow.tools.builtins.wiki_search_tool import _wiki_search_impl
from deerflow.uploads.manager import normalize_filename
from deerflow.utils.file_io import run_file_io

logger = logging.getLogger(__name__)


class DocumentProcessingError(RuntimeError):
    """Raised when a per-chunk operation collides with an in-flight document pipeline (Phase-3 Batch-1 P3)."""

    def __init__(self, doc_id: str, status: str) -> None:
        super().__init__(f"Document {doc_id} is being processed (status={status})")
        self.doc_id = doc_id
        self.status = status


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
        wiki_generate_fn: Callable[[str, bool], None] | None = None,
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

    async def list_documents(self, kb_id: str) -> list[dict[str, Any]]:
        """Documents with the per-path sub-status (phase-2 batch-1 P3, spec §5).

        The stored ``path_status`` carries vector/graph only; the wiki leg is a
        **library-level mirror** injected here at assembly time. The mirror
        only applies to terminal documents (ready/failed): a document still in
        the indexing pipeline has not been digested by the wiki leg at all, so
        its wiki line reports ``pending`` instead of mirroring the library's
        stale ``ready`` (2026-08-13 口径——否则新文档在索引期间会错误显示旧内容
        的「已生成」). Rows whose stored path_status is NULL (legacy) stay NULL
        so the frontend renders no hover for them.
        """
        documents = await self.store.list_documents(kb_id)
        wiki_status = await self._wiki_path_status(kb_id)
        for document in documents:
            path_status = document.get("path_status")
            if path_status is None:
                continue
            wiki = wiki_status if document["status"] in ("ready", "failed") else "pending"
            document["path_status"] = {**path_status, "wiki": wiki}
        return documents

    async def _wiki_path_status(self, kb_id: str) -> str:
        """Library-level wiki status (shared by all documents of the KB).

        An in-flight run (manual button or worker auto trigger) reports
        ``generating`` — checked FIRST, otherwise the state could only ever
        appear on an empty library's very first generation and every later
        incremental digest would be invisible (2026-08-13 口径调整).
        Otherwise ready/dirty entries mean generated content is available
        (dirty = generated-but-stale still counts as ready, 2026-08-12 口径);
        nothing at all reports ``pending``.
        """
        if wiki_generation_in_progress(kb_id):
            return "generating"
        entries = await self.wiki_store.list_entries(kb_id)
        if any(entry["status"] in ("ready", "dirty") for entry in entries):
            return "ready"
        return "pending"

    async def upload_document(self, *, kb_id: str, uploader_id: str, filename: str, content: bytes) -> dict[str, Any]:
        """Persist the file, create the ``uploaded`` row, enqueue indexing."""
        import hashlib

        doc_id = uuid.uuid4().hex
        safe_name = normalize_filename(filename or "document")
        # Task 6 (spec §6): upload allowlist gate — reject before any file I/O.
        suffix = Path(safe_name).suffix.lower()
        if not is_supported_suffix(suffix):
            supported = ", ".join(sorted(SUPPORTED_UPLOAD_SUFFIXES))
            raise ValueError(f"unsupported file type '{suffix or '(none)'}'; supported formats: {supported}")

        # Task 11: compute SHA-256 hash for duplicate detection
        content_hash = hashlib.sha256(content).hexdigest()

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
            content_hash=content_hash,
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
        # 条目生命周期（spec §3.5：资格即条目存在理由，失格即删）：剩余
        # freq ≥ 2 的受影响实体仅标 dirty 等增量重生成；跌下阈值的失格实体
        # 与消失实体（孤儿）的条目连行带向量一并删除。实体节点与
        # kb_entities 不动 —— 剩余活切片仍由向量路直接服务。
        disqualified = list(orphaned)
        if affected:
            remaining = {row["name"]: len(row.get("source_chunk_ids") or []) for row in await self.graph_store.list_entities(kb_id)}
            still_eligible = [name for name in affected if remaining.get(name, 0) >= 2]
            if still_eligible:
                await self.wiki_store.mark_dirty_for_titles(kb_id, still_eligible)
            disqualified.extend(name for name in affected if remaining.get(name, 0) < 2)
        if disqualified:
            await self._delete_wiki_entries(kb_id, disqualified)
        await self.store.delete_document(doc_id)
        await self._remove_dir(self.data_dir / "knowledge" / kb_id / doc_id)
        return True

    async def _delete_wiki_entries(self, kb_id: str, titles: Collection[str]) -> None:
        """Delete wiki entries whose entity lost eligibility or vanished.

        Qdrant first, failures logged and swallowed (the module-level cascade
        ordering rule); the business row always goes so a vector outage never
        strands the lifecycle half-applied. Idempotent.
        """
        titles = list(titles)
        if not titles:
            return
        try:
            await self.vector_store.delete_wiki_entries(kb_id, titles)
        except Exception:
            logger.exception("qdrant delete_wiki_entries failed for kb %s (%d titles)", kb_id, len(titles))
        await self.wiki_store.delete_entries(kb_id, titles)

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
                # Retry re-indexes the same document right away, so plain
                # dirty suffices — no eligibility cascade on this path.
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

    def trigger_wiki_generation(self, kb_id: str, *, only_dirty: bool = True) -> bool:
        """Fire-and-forget wiki generation (Task 14: incremental by default;
        ``only_dirty=False`` rebuilds every eligible entry).

        Returns False when a run is already in flight — manual or worker
        auto, both share the in-flight counter — so the router reports
        ``already_running`` instead of queueing a duplicate LLM run
        (P1 触发幂等, 2026-08-14).
        """
        if wiki_generation_in_progress(kb_id):
            return False
        self.wiki_generate_fn(kb_id, only_dirty)
        return True

    async def list_wiki_entries(self, kb_id: str) -> dict[str, Any]:
        """Summary-only listing for the wiki tab (phase-2 batch-1).

        Full content stays out of the list payload — the drawer fetches it via
        the detail endpoint. ``summary`` is a plain content prefix.

        Wiki 更新状态可见 (2026-08-14): the payload also carries the
        library-level ``generation`` flag (same in-flight source as
        ``path_status.wiki``) so the wiki tab itself can render 更新中 and
        poll until the run drains — previously the badge only refreshed on
        tab re-entry.
        """
        entries = await self.wiki_store.list_entries(kb_id)
        return {
            "entries": [
                {
                    "id": entry["id"],
                    "title": entry["title"],
                    "summary": entry["content"][:120],
                    "status": entry["status"],
                    "updated_at": entry["updated_at"],
                }
                for entry in entries
            ],
            "generation": "generating" if wiki_generation_in_progress(kb_id) else "idle",
            # P1 失败可见性: terminal status of the most recent run (None =
            # never ran in this process) — the completion toast keys off it.
            "last_run": wiki_last_run_status(kb_id),
        }

    async def get_wiki_entry(self, *, kb_id: str, entry_id: str) -> dict[str, Any] | None:
        """Full entry for the drawer; None when missing or owned by another kb."""
        entry = await self.wiki_store.get_entry(entry_id)
        if entry is None or entry["kb_id"] != kb_id:
            return None
        return entry

    async def delete_wiki_entry(self, *, kb_id: str, entry_id: str) -> bool:
        """Manually delete one wiki entry: business row + vector point (Task 13).

        The entity node and its ``kb_entities`` vector stay untouched.
        Regeneration semantics (2026-08-13 拍板): if the entity is still
        eligible, the next ``generate_wiki`` backfill recreates the entry
        from current material — a manual delete is a *reset* for eligible
        entries and permanent only for disqualified/vanished ones.
        """
        entry = await self.wiki_store.get_entry(entry_id)
        if entry is None or entry["kb_id"] != kb_id:
            return False
        await self._delete_wiki_entries(kb_id, [entry["title"]])
        return True

    async def update_wiki_entry(
        self,
        *,
        kb_id: str,
        entry_id: str,
        content: str,
        supplement_content: str | None,
    ) -> dict | None:
        """Update wiki entry content and supplement layer (Phase-3 Batch-1 P1).

        Main content can be replaced by next LLM re-generation; supplement layer
        persists across regeneration cycles.
        """
        # Verify entry exists and belongs to this kb
        entry = await self.wiki_store.get_entry(entry_id)
        if entry is None or entry["kb_id"] != kb_id:
            return None

        # Update via store (title comes from existing entry)
        updated = await self.wiki_store.upsert_entry(
            kb_id=kb_id,
            title=entry["title"],
            content=content,
            source_chunk_ids=entry["source_chunk_ids"],
            status=entry["status"],
            supplement_content=supplement_content,
        )
        return updated

    async def update_chunk_text(self, *, kb_id: str, chunk_id: str, text: str) -> dict | None:
        """Update chunk text with re-embedding (Phase-3 Batch-1 P2).

        Recalculates token_count, writes last_edited_at, and re-embeds into
        Qdrant — same chunk_id maps to the same point id, so the upsert
        overwrites the stale vector in place (Task 4 收尾, 2026-08-14).
        Entities JSON column remains unchanged (ID 引用 preserved).

        Ordering: embed BEFORE the DB write so an embedder outage leaves the
        stored text untouched; a Qdrant upsert failure after the write
        surfaces as 500 — visible, and a retry converges (no silent
        DB/vector divergence).
        """
        # Get existing chunk to verify it exists and belongs to kb
        chunk = await self.store.get_chunk(chunk_id)
        if chunk is None or chunk["kb_id"] != kb_id:
            return None

        # Recalculate token count
        from deerflow.knowledge.chunker import count_tokens

        new_token_count = count_tokens(text)

        # Re-embed first (see docstring for the ordering rationale).
        from deerflow.knowledge.embedder import DashScopeEmbedder

        embeddings = await DashScopeEmbedder().embed([text])

        # Update in DB (entities unchanged - ID 引用 preserved)
        updated = await self.store.update_chunk_text(
            chunk_id=chunk_id,
            text=text,
            token_count=new_token_count,
        )
        if updated is None:
            return None

        from deerflow.knowledge.vector_store import ChunkUpsert

        document = await self.store.get_document(chunk["doc_id"])
        await self.vector_store.upsert_chunks(
            [
                ChunkUpsert(
                    chunk_id=chunk_id,
                    kb_id=kb_id,
                    doc_id=chunk["doc_id"],
                    dense=embeddings[0].dense,
                    sparse=embeddings[0].sparse,
                    doc_name=document["name"] if document else "",
                    heading_path=list(chunk.get("heading_path") or []),
                    page=chunk.get("page"),
                    entities=list(chunk.get("entities") or []),
                )
            ]
        )

        return updated

    async def preview_chunk_deletion(self, *, kb_id: str, chunk_ids: list[str]) -> dict[str, Any] | None:
        """Calculate deletion impact without actually deleting (Phase-3 Batch-1 P5).

        Returns orphaned entities, affected entities, and relation deletions
        for preview in delete confirmation dialog.
        """
        if not chunk_ids:
            return {"orphaned_entities": [], "affected_entities": [], "relation_deletions": []}

        # Verify all chunks exist and belong to this kb
        for chunk_id in chunk_ids:
            chunk = await self.store.get_chunk(chunk_id)
            if chunk is None or chunk["kb_id"] != kb_id:
                return None  # Any invalid chunk → 404

        # Call graph store's pure calculation
        impact = await self.graph_store.calculate_deletion_impact(kb_id, chunk_ids)
        return impact

    async def delete_chunk_cascade(self, *, kb_id: str, chunk_id: str) -> bool | None:
        """Delete one chunk across graph/wiki/vector/business stores (Task 5 收尾).

        Reuses the same cascade pieces as ``re_extract_chunk`` /
        ``delete_document_cascade`` — nothing rewritten: strip graph
        contributions → orphan entities lose ``kb_entities`` vectors + wiki
        entries → affected entities re-checked against the ≥2-source bar
        (dirty vs disqualify) → chunk vector point → business row, then the
        document's chunk_count is refreshed. Vector failures are logged and
        swallowed (module cascade ordering rule); the business row always goes.

        Same concurrency guard as re-extraction: only terminal document
        states (ready/failed) may lose a chunk.
        """
        chunk = await self.store.get_chunk(chunk_id)
        if chunk is None or chunk["kb_id"] != kb_id:
            return None
        document = await self.store.get_document(chunk["doc_id"])
        if document is not None and document["status"] not in ("ready", "failed"):
            raise DocumentProcessingError(chunk["doc_id"], document["status"])

        orphaned, affected = await self.graph_store.remove_chunk_contributions(kb_id, [chunk_id])
        if orphaned:
            try:
                await self.vector_store.delete_entities(kb_id, orphaned)
            except Exception:
                logger.exception("qdrant delete_entities failed for chunk-delete orphans of %s", chunk_id)
            await self._delete_wiki_entries(kb_id, orphaned)
        if affected:
            remaining = {row["name"]: len(row.get("source_chunk_ids") or []) for row in await self.graph_store.list_entities(kb_id)}
            still_eligible = [name for name in affected if remaining.get(name, 0) >= 2]
            disqualified = [name for name in affected if remaining.get(name, 0) < 2]
            if still_eligible:
                await self.wiki_store.mark_dirty_for_titles(kb_id, still_eligible)
            if disqualified:
                await self._delete_wiki_entries(kb_id, disqualified)

        try:
            await self.vector_store.delete_chunks([chunk_id])
        except Exception:
            logger.exception("qdrant delete_chunks failed for %s", chunk_id)
        deleted = await self.store.delete_chunk(chunk_id)
        if deleted and document is not None:
            remaining_chunks = await self.store.list_chunks(chunk["doc_id"], limit=1_000_000)
            await self.store.update_document_status(chunk["doc_id"], document["status"], chunk_count=len(remaining_chunks))
        return deleted

    async def re_extract_chunk(self, *, kb_id: str, chunk_id: str) -> dict[str, Any] | None:
        """Re-extract entities/relations for a single chunk (Phase-3 Batch-1 P3, Spec §5).

        Five-step flow (reuses existing cascade pieces — nothing rewritten):
        1. ``remove_chunk_contributions`` strips this chunk's old graph contributions.
        2. Orphaned entities → delete ``kb_entities`` vectors + wiki disqualification chain.
        3. Per-chunk extraction on the chunk's CURRENT text (never re-parses the
           source file — manual edits would be clobbered, spec §1 fact 3).
        4. Reverse link: normalized names onto the ``kb_chunks`` Qdrant payload.
        5. Still-eligible affected ∪ new entities → wiki dirty chain (资格制 ≥2 sources).

        Concurrency guard (spec §5 A3): only terminal document states (ready/failed)
        may trigger a re-extraction.
        """
        chunk = await self.store.get_chunk(chunk_id)
        if chunk is None or chunk["kb_id"] != kb_id:
            return None

        document = await self.store.get_document(chunk["doc_id"])
        if document is not None and document["status"] not in ("ready", "failed"):
            raise DocumentProcessingError(chunk["doc_id"], document["status"])

        # Step 1: strip old graph contributions for this chunk only
        orphaned, affected = await self.graph_store.remove_chunk_contributions(kb_id, [chunk_id])

        # Mark extraction as pending (for cross-session progress tracking)
        await self.store.update_chunk_extract(chunk_id, "pending")

        # Step 2: orphaned entities lose their vectors + wiki entries (失格链)
        if orphaned:
            try:
                await self.vector_store.delete_entities(kb_id, orphaned)
            except Exception:
                logger.exception("qdrant delete_entities failed for re-extract orphans of %s", chunk_id)
            await self._delete_wiki_entries(kb_id, orphaned)

        # Step 3: re-extract on the current (possibly manually edited) text
        from deerflow.knowledge.embedder import DashScopeEmbedder

        embedder = DashScopeEmbedder()
        new_names = await extract_single_chunk(
            self.store,
            self.graph_store,
            kb_id=kb_id,
            chunk_id=chunk_id,
            text=chunk["text"],
            embedder=embedder,
        )

        # Step 4: reverse link — normalized names onto the kb_chunks payload
        if new_names:
            try:
                await self.vector_store.set_chunk_entities({chunk_id: new_names})
            except Exception:
                logger.exception("qdrant set_chunk_entities failed for %s", chunk_id)
            # Re-embed the touched entity name+description into kb_entities so
            # graph_search keeps matching them (same as the document leg).
            try:
                rows = await self.graph_store.list_entities(kb_id)
                targets = [row for row in rows if row["name"] in set(new_names)]
                if targets:
                    from deerflow.knowledge.vector_store import EntityUpsert

                    embeddings = await embedder.embed([f"{row['name']}\n{row.get('description') or ''}" for row in targets])
                    await self.vector_store.upsert_entities(
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
            except Exception:
                logger.exception("qdrant upsert_entities failed during re-extract of %s", chunk_id)

        # Step 5: wiki dirty chain — affected entities keep eligibility only
        # with ≥2 remaining sources (资格制, mirrors delete_document_cascade);
        # new entities join the dirty set so incremental wiki picks them up.
        if affected:
            remaining = {row["name"]: len(row.get("source_chunk_ids") or []) for row in await self.graph_store.list_entities(kb_id)}
            still_eligible = [name for name in affected if remaining.get(name, 0) >= 2]
            disqualified = [name for name in affected if remaining.get(name, 0) < 2]
            if disqualified:
                await self._delete_wiki_entries(kb_id, disqualified)
        else:
            still_eligible = []
        dirty_titles = sorted(set(still_eligible) | set(new_names))
        if dirty_titles:
            await self.wiki_store.mark_dirty_for_titles(kb_id, dirty_titles)

        return await self.store.get_chunk(chunk_id)

    # ── manual knowledge cards (Phase-3 Batch-1 P6, spec §8) ─────────────

    @staticmethod
    def _manual_card_embed_text(title: str, content: str) -> str:
        """Embedding input for a card — same ``name\\ndescription`` shape as entities."""
        return f"{title}\n{content}"

    async def create_manual_card(
        self,
        *,
        kb_id: str,
        owner_id: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        include_in_wiki_search: bool = False,
    ) -> dict[str, Any]:
        """Create a manual knowledge card.

        Cards with the wiki-search toggle on are embedded and upserted into
        ``kb_manual_cards`` so the Task-8 wiki-path merge can retrieve them.
        Ordering mirrors ``update_chunk_text``: embed BEFORE the DB write (an
        embedder outage leaves no row); an upsert failure after the write
        surfaces as 500 — visible, and re-saving the card converges.
        """
        embedding = None
        if include_in_wiki_search:
            from deerflow.knowledge.embedder import DashScopeEmbedder

            embedding = (await DashScopeEmbedder().embed([self._manual_card_embed_text(title, content)]))[0]

        card = await self.store.create_manual_card(
            card_id=uuid.uuid4().hex,
            kb_id=kb_id,
            owner_id=owner_id,
            title=title,
            content=content,
            tags=tags,
            include_in_wiki_search=include_in_wiki_search,
        )
        if embedding is not None:
            from deerflow.knowledge.vector_store import ManualCardUpsert

            await self.vector_store.upsert_manual_cards([ManualCardUpsert(card_id=card["id"], kb_id=kb_id, title=title, dense=embedding.dense)])
        return card

    async def list_manual_cards(
        self,
        *,
        kb_id: str,
        offset: int = 0,
        limit: int = 50,
        include_in_wiki_search: bool | None = None,
    ) -> dict[str, Any]:
        """Summary-only listing (wiki-list pattern): full content stays out of
        the list payload — the panel fetches it via the detail endpoint."""
        items = await self.store.list_manual_cards(kb_id, offset=offset, limit=limit, include_in_wiki_search=include_in_wiki_search)
        total = await self.store.count_manual_cards(kb_id, include_in_wiki_search=include_in_wiki_search)
        return {
            "items": [
                {
                    "id": card["id"],
                    "title": card["title"],
                    "summary": card["content"][:120],
                    "tags": card["tags"],
                    "include_in_wiki_search": card["include_in_wiki_search"],
                    "created_at": card["created_at"],
                    "updated_at": card["updated_at"],
                }
                for card in items
            ],
            "total": total,
            "offset": offset,
            "limit": limit,
        }

    async def get_manual_card(self, *, kb_id: str, card_id: str) -> dict[str, Any] | None:
        """Full card for the editor; None when missing or owned by another kb."""
        card = await self.store.get_manual_card(card_id)
        if card is None or card["kb_id"] != kb_id:
            return None
        return card

    async def update_manual_card(
        self,
        *,
        kb_id: str,
        card_id: str,
        title: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        include_in_wiki_search: bool | None = None,
    ) -> dict[str, Any] | None:
        """PATCH a card; the toggle drives the vector-point lifecycle.

        - toggle on / title+content edit while on → re-embed + upsert
          (same point id, overwrite in place);
        - toggle off → the point goes (the card stays management-only);
        - flag off and no flag change → zero vector work.
        """
        card = await self.store.get_manual_card(card_id)
        if card is None or card["kb_id"] != kb_id:
            return None

        effective_flag = include_in_wiki_search if include_in_wiki_search is not None else card["include_in_wiki_search"]
        effective_title = title if title is not None else card["title"]
        effective_content = content if content is not None else card["content"]
        turning_on = include_in_wiki_search is True and not card["include_in_wiki_search"]
        turning_off = include_in_wiki_search is False and card["include_in_wiki_search"]
        text_changed = (title is not None and title != card["title"]) or (content is not None and content != card["content"])

        # Embed before the DB write (same ordering contract as chunk editing).
        embedding = None
        if effective_flag and (turning_on or text_changed):
            from deerflow.knowledge.embedder import DashScopeEmbedder

            embedding = (await DashScopeEmbedder().embed([self._manual_card_embed_text(effective_title, effective_content)]))[0]

        updated = await self.store.update_manual_card(
            card_id,
            title=title,
            content=content,
            tags=tags,
            include_in_wiki_search=include_in_wiki_search,
        )
        if updated is None:
            return None

        if embedding is not None:
            from deerflow.knowledge.vector_store import ManualCardUpsert

            await self.vector_store.upsert_manual_cards([ManualCardUpsert(card_id=card_id, kb_id=kb_id, title=effective_title, dense=embedding.dense)])
        elif turning_off:
            try:
                await self.vector_store.delete_manual_cards([card_id])
            except Exception:
                logger.exception("qdrant delete_manual_cards failed for toggle-off of %s", card_id)
        return updated

    async def delete_manual_card(self, *, kb_id: str, card_id: str) -> bool:
        """Delete one card: vector point first (failures logged + swallowed,
        module cascade rule), the business row always goes."""
        card = await self.store.get_manual_card(card_id)
        if card is None or card["kb_id"] != kb_id:
            return False
        try:
            await self.vector_store.delete_manual_cards([card_id])
        except Exception:
            logger.exception("qdrant delete_manual_cards failed for %s; continuing row cleanup", card_id)
        return await self.store.delete_manual_card(card_id)

    # ── recall test (P1, phase-2 batch-1) ────────────────────────────────

    #: Score semantics differ per path — never compare across paths.
    _RECALL_SCORE_TYPES = {
        "vector": "qwen3-rerank relevance",
        "graph": "embedding cosine（当次可比）",
        "wiki": "embedding cosine",
    }

    async def recall_test(self, *, kb_id: str, user_id: str, query: str, top_k: int) -> dict[str, Any]:
        """Fan one query out to the three retrieval paths (spec P1).

        Reuses the online tools' ``_*_impl`` verbatim — the only difference
        from the agent path is that no LLM answer synthesis happens and raw
        hits/scores/elapsed are returned. A single path's failure degrades to
        empty hits with a failure note instead of failing the whole response.
        """
        from deerflow.config.app_config import get_app_config

        rag = get_app_config().rag
        runtime = SimpleNamespace(context={"kb_id": kb_id, "user_id": user_id})

        async def _timed(coro) -> tuple[Any, int]:
            start = time.monotonic()
            try:
                return await coro, int((time.monotonic() - start) * 1000)
            except Exception as exc:  # degradation is the contract — one path must not sink the response
                logger.exception("recall-test path failed for kb %s", kb_id)
                return exc, int((time.monotonic() - start) * 1000)

        (vector_raw, vector_ms), (graph_raw, graph_ms), (wiki_raw, wiki_ms) = await asyncio.gather(
            _timed(_hybrid_search_impl(query, runtime, store=self.store, vector_store=self.vector_store, top_k=top_k)),
            _timed(
                _graph_search_impl(
                    query,
                    runtime,
                    store=self.store,
                    graph_store=self.graph_store,
                    vector_store=self.vector_store,
                    # mirror the online wrapper's config-driven parameters;
                    # the recall test's top_k maps to evidence_limit
                    reranker=DashScopeReranker() if rag.graph_rerank else None,
                    per_entity_cap=rag.graph_per_entity_cap,
                    per_edge_cap=rag.graph_per_edge_cap,
                    hop0_guarantee=rag.graph_hop0_guarantee,
                    evidence_limit=top_k,
                    graph_rerank=rag.graph_rerank,
                    rerank_threshold=rag.graph_rerank_threshold,
                    hop_penalty=rag.graph_hop_penalty,
                    neighbor_min_score=rag.graph_neighbor_min_score,
                    max_expanded_nodes=rag.graph_max_expanded_nodes,
                    hub_degree_threshold=rag.graph_hub_degree_threshold,
                )
            ),
            _timed(_wiki_search_impl(query, runtime, store=self.store, wiki_store=self.wiki_store, vector_store=self.vector_store, top_k=top_k)),
        )

        def _failure_note(exc: BaseException) -> str:
            return f"该路检索失败（{type(exc).__name__}），详情见服务端日志。"

        # Impl messages carry a model-directed citation-span note（引用编号…
        # 照抄 citation_no）— prompt plumbing for the answering model. The
        # recall-test UI shows messages to humans, so strip the note here.
        span_note = re.compile(r"（引用编号 [^）]*）")

        def _user_facing(message: str) -> str:
            return span_note.sub("", message)

        if isinstance(vector_raw, BaseException):
            vector_path: dict[str, Any] = {"hits": [], "message": _failure_note(vector_raw)}
        else:
            vector_path = {
                "hits": [
                    {
                        "chunk_id": item["chunk_id"],
                        "doc_name": item.get("doc_name") or "",
                        "text": item.get("text", ""),
                        "heading_path": item.get("heading_path") or [],
                        "page": item.get("page"),
                        # rerank 降级时 impl 不返回 score 键 → 显式 null（schema 可空）
                        "score": item.get("score"),
                        "rank": rank,
                    }
                    for rank, item in enumerate(vector_raw.get("results", []), start=1)
                ],
                "message": _user_facing(vector_raw.get("message", "")),
            }

        if isinstance(graph_raw, BaseException):
            graph_path: dict[str, Any] = {"entities": [], "relations": [], "evidence": [], "message": _failure_note(graph_raw)}
        else:
            graph_path = {
                "entities": graph_raw.get("entities", []),
                "relations": graph_raw.get("relations", []),
                "evidence": graph_raw.get("evidence", []),
                "message": _user_facing(graph_raw.get("message", "")),
            }

        if isinstance(wiki_raw, BaseException):
            wiki_path: dict[str, Any] = {"hits": [], "message": _failure_note(wiki_raw)}
        else:
            wiki_path = {
                "hits": [
                    {
                        "entry_id": entry["entry_id"],
                        "title": entry["title"],
                        "summary": (entry.get("content") or "")[:120],
                        "score": entry.get("score"),
                        "rank": rank,
                        # Phase-3 P6（spec §8 混排）：人工卡片也走 wiki 路，
                        # 透传 source_type 供前端分流「条目抽屉 / 卡片抽屉」；
                        # 缺键回退 wiki（旧 impl 形态）。
                        "source_type": entry.get("source_type") or "wiki",
                    }
                    for rank, entry in enumerate(wiki_raw.get("entries", []), start=1)
                ],
                "message": _user_facing(wiki_raw.get("message", "")),
            }

        return {
            "query": query,
            "paths": {"vector": vector_path, "graph": graph_path, "wiki": wiki_path},
            "score_type": dict(self._RECALL_SCORE_TYPES),
            "elapsed_ms": {"vector": vector_ms, "graph": graph_ms, "wiki": wiki_ms},
        }

    def _schedule_wiki_generation(self, kb_id: str, only_dirty: bool = True) -> None:
        task = asyncio.create_task(self._run_wiki_generation(kb_id, only_dirty=only_dirty), name=f"kb-wiki-{kb_id}")
        self._wiki_tasks.add(task)
        task.add_done_callback(self._wiki_tasks.discard)

    async def _run_wiki_generation(self, kb_id: str, *, only_dirty: bool = True) -> None:
        try:
            from deerflow.knowledge.embedder import DashScopeEmbedder

            # generate_wiki silently skips the vector upsert without an embedder —
            # entries would exist but wiki_search could never find them.
            await generate_wiki(self.store, self.graph_store, self.wiki_store, self.vector_store, kb_id=kb_id, embedder=DashScopeEmbedder(), only_dirty=only_dirty)
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
