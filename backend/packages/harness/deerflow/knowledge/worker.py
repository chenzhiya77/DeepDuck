"""Async indexing worker: drives documents through the status machine (spec §3.6/§3.7).

The upload API only persists the ``documents`` row and enqueues the doc id;
this worker runs the long pipeline in the background with a semaphore cap
(``rag.worker_concurrency``):

    uploaded → parsing → chunking → indexing → ready / failed

Resume semantics (spec §3.7 启动恢复):
- Startup recovery re-enqueues every non-terminal document.
- A crash before ``indexing`` re-runs parse → chunk from scratch after wiping
  the partial chunk/vector/graph output (chunk ids are deterministic).
- A crash inside ``indexing`` re-runs the vector leg (point ids are
  deterministic ``uuid5`` — upserts overwrite in place) and the graph leg,
  which only processes ``pending`` chunks, so ``done`` slices are never
  re-extracted.
- ``progress_percent`` tracks graph-settled/total chunks (the slowest leg).

Wiki: once the KB's completion share crosses the trigger threshold, the first
batch runs full-head generation; afterwards the worker runs the dirty
incremental pass (spec §3.7 触发式批量 → dirty 增量).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Protocol

from deerflow.knowledge.captioner import apply_captions, caption_images
from deerflow.knowledge.chunker import chunk_markdown
from deerflow.knowledge.embedder import DashScopeEmbedder, EmbeddingResult
from deerflow.knowledge.graph.indexer import index_document_graph
from deerflow.knowledge.graph.resolver import resolve_entity_aliases
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.indexer import index_chunks
from deerflow.knowledge.parser import ParsedDocument, ParsedImage, parse_document
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.vector_store import KnowledgeVectorStore
from deerflow.knowledge.wiki.generator import generate_wiki, mark_dirty_for_entities, wiki_trigger_ready
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.utils.file_io import run_file_io

logger = logging.getLogger(__name__)


class _DocumentDeletedError(Exception):
    """The document row vanished mid-pipeline (user deleted it) — abort quietly."""


class EmptyParseResultError(Exception):
    """The parser returned no text at all — indexing would otherwise walk to a
    ``ready`` document with zero chunks (silent data loss, 2026-09-04 实测：
    MinerU 对纯标题/超短页返回空 full.md), so the pipeline fails loudly with
    an actionable, retryable error instead."""


class _LLM(Protocol):
    async def ainvoke(self, messages: Any) -> Any: ...


class _Embedder(Protocol):
    batch_size: int

    async def embed(self, texts, *, text_type: str = "document") -> list[EmbeddingResult]: ...


class KnowledgeIndexWorker:
    """Background asyncio worker for the offline indexing pipeline."""

    def __init__(
        self,
        *,
        store: KnowledgeStore,
        vector_store: KnowledgeVectorStore,
        graph_store: GraphStore | None = None,
        wiki_store: WikiStore | None = None,
        concurrency: int = 2,
        parse_fn: Callable[[str], Awaitable[ParsedDocument]] | None = None,
        embedder: _Embedder | None = None,
        llm: _LLM | None = None,
        main_llm: _LLM | None = None,
        gleaning_rounds: int = 1,
        resolution_full_scan_threshold: int = 500,
        entity_merge_similarity: float = 0.92,
    ) -> None:
        self._store = store
        self._vector_store = vector_store
        self._graph_store = graph_store or GraphStore(store._sf)
        self._wiki_store = wiki_store or WikiStore(store._sf)
        self._parse_fn = parse_fn or parse_document
        self._embedder = embedder
        self._llm = llm
        self._main_llm = main_llm
        self._gleaning_rounds = gleaning_rounds
        self._resolution_full_scan_threshold = resolution_full_scan_threshold
        self._entity_merge_similarity = entity_merge_similarity
        self._sem = asyncio.Semaphore(concurrency)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._dispatcher: asyncio.Task[None] | None = None
        self._inflight: set[asyncio.Task[None]] = set()

    # ── lifecycle ────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start the dispatcher after startup-recovery re-enqueues (spec §3.7).

        A Qdrant outage must not block gateway startup: collection init
        failures are logged and the dispatcher still runs — affected documents
        surface as ``failed`` with the connection error, and the next gateway
        restart re-enqueues them.
        """
        if self._dispatcher is not None:
            return
        try:
            await self._vector_store.init_collections()
        except Exception:
            logger.exception("Qdrant collection init failed at worker start; indexing will fail per-document until Qdrant is reachable")
        recovered = await self.recover()
        if recovered:
            logger.info("knowledge worker recovery: re-enqueued %d non-terminal document(s)", recovered)
        self._dispatcher = asyncio.create_task(self._dispatch_loop(), name="knowledge-index-worker")

    async def stop(self) -> None:
        dispatcher, self._dispatcher = self._dispatcher, None
        if dispatcher is not None:
            dispatcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await dispatcher
        if self._inflight:
            await asyncio.gather(*list(self._inflight), return_exceptions=True)

    async def recover(self) -> int:
        """Re-enqueue every non-terminal document; returns the count."""
        documents = await self._store.list_non_terminal_documents()
        for document in documents:
            await self.submit(document["id"])
        return len(documents)

    async def submit(self, doc_id: str) -> None:
        await self._queue.put(doc_id)

    async def _require_alive(self, doc_id: str) -> None:
        """Liveness checkpoint against the delete-vs-worker race: a document
        deleted mid-pipeline must not be resurrected by further writes
        (insert_chunks / graph upserts would otherwise recreate zombie rows
        and phantom chunk references; status updates no-op silently)."""
        if await self._store.get_document(doc_id) is None:
            raise _DocumentDeletedError(doc_id)

    async def wait_idle(self) -> None:
        """Block until the queue drains and in-flight documents settle (tests)."""
        await self._queue.join()
        # task_done fires in _run_guarded's finally just before task completion;
        # gather lets those tasks finish and surfaces exceptions. The sleep(0)
        # yields to the loop so done-callbacks (inflight discard) can run —
        # awaiting an already-finished task never yields and would spin forever.
        while self._inflight:
            await asyncio.gather(*list(self._inflight), return_exceptions=True)
            await asyncio.sleep(0)

    async def _dispatch_loop(self) -> None:
        while True:
            doc_id = await self._queue.get()
            task = asyncio.create_task(self._run_guarded(doc_id))
            self._inflight.add(task)
            task.add_done_callback(self._inflight.discard)

    async def _run_guarded(self, doc_id: str) -> None:
        try:
            async with self._sem:
                await self.process_document(doc_id)
        finally:
            self._queue.task_done()

    # ── pipeline ─────────────────────────────────────────────────────────

    async def process_document(self, doc_id: str) -> dict[str, Any] | None:
        """Run one document through the status machine; never raises."""
        document = await self._store.get_document(doc_id)
        if document is None or document["status"] in ("ready", "failed"):
            return document
        kb_id = document["kb_id"]
        # P3 per-path sub-status (spec 2026-08-11 §5): initialized up front so the
        # hover breakdown exists from the parsing stage on (2026-08-12 UX fix) —
        # only pre-0012 legacy rows stay NULL and render no hover. Partial-merge
        # writes follow as each leg advances; the wiki leg is NOT tracked on the
        # row (library-level mirror injected at read time by the API).
        legs: dict[str, str] = {"vector": "pending", "graph": "pending"}
        try:
            if document["status"] in ("uploaded", "parsing", "chunking"):
                await self._reparse_and_chunk(doc_id, kb_id, document["storage_path"])

            await self._require_alive(doc_id)  # checkpoint: before the vector leg
            await self._store.update_document_status(doc_id, "indexing", path_status=legs)
            chunks = await self._store.list_chunks(doc_id, limit=1_000_000)
            embedder = self._embedder or DashScopeEmbedder()
            if chunks:
                index_stats = await index_chunks(self._store, self._vector_store, embedder, kb_id=kb_id, doc_id=doc_id, chunks=chunks)
                # Every batch soft-failed (EmbedderError degradation) → nothing
                # indexed: surface the first observable failure marker for the
                # vector leg instead of a misleading "done".
                legs["vector"] = "done" if index_stats.indexed > 0 else "failed"
            else:
                legs["vector"] = "done"
            await self._store.update_document_status(doc_id, "indexing", path_status={"vector": legs["vector"]})

            async def _on_progress(settled: int, total: int) -> None:
                percent = (settled * 100) // total if total else 100
                await self._store.update_document_status(doc_id, "indexing", progress_percent=percent)

            legs["graph"] = "indexing"
            await self._store.update_document_status(doc_id, "indexing", path_status={"graph": "indexing"})
            await self._require_alive(doc_id)  # checkpoint: before the (slowest) graph leg
            stats = await index_document_graph(
                self._store,
                self._graph_store,
                self._vector_store,
                kb_id=kb_id,
                doc_id=doc_id,
                chunks=chunks,
                llm=self._llm,
                embedder=embedder,
                gleaning_rounds=self._gleaning_rounds,
                name_similarity_threshold=self._entity_merge_similarity,
                progress_callback=_on_progress,
            )
            # Checkpoint: the graph leg is the longest window for a delete to
            # land in. Entities written before this point CAN still reference a
            # since-deleted doc's chunks — that residual window is acknowledged
            # and covered by the phantom-contribution cleanup (plan Task 9).
            await self._require_alive(doc_id)
            # Same verdict source as the ``graph degraded`` error sub-marker.
            legs["graph"] = "degraded" if stats.degraded else "done"
            await self._store.update_document_status(doc_id, "indexing", path_status={"graph": legs["graph"]})
            # D3: merge cross-slice entity aliases right after the graph leg.
            # A failing resolution never blocks the pipeline — the document
            # still reaches ``ready`` with a visible error sub-marker.
            try:
                await resolve_entity_aliases(
                    self._store,
                    self._graph_store,
                    self._vector_store,
                    self._wiki_store,
                    embedder,
                    kb_id=kb_id,
                    touched_entities=stats.touched_entities,
                    full_scan_threshold=self._resolution_full_scan_threshold,
                    similarity_threshold=self._entity_merge_similarity,
                )
            except Exception:
                logger.exception("entity re-resolution failed for document %s", doc_id)
                await self._append_error_marker(doc_id, "entity-resolution failed")
            # Task 5b (spec §3.5 2026-08-12 revision): flag the wiki entries of
            # the entities this document touched as ``dirty`` so the following
            # incremental refresh regenerates exactly them. Library-level
            # concern: a failure degrades to a log line only — never blocks
            # ``ready``, never appends an error sub-marker.
            try:
                await mark_dirty_for_entities(self._wiki_store, kb_id, stats.touched_entities)
            except Exception:
                logger.exception("wiki dirty marking failed for kb %s", kb_id)
            await self._store.update_document_status(doc_id, "ready", progress_percent=100)
            await self._maybe_generate_wiki(kb_id, embedder)
        except _DocumentDeletedError:
            logger.info("document %s was deleted mid-indexing; pipeline aborted quietly", doc_id)
            return None
        except Exception as exc:
            logger.exception("knowledge indexing failed for document %s", doc_id)
            # Legs that never reached a terminal state fail with the document;
            # terminal verdicts (done/degraded) are preserved.
            failed_legs = {leg: "failed" for leg, state in legs.items() if state not in ("done", "degraded")}
            await self._store.update_document_status(doc_id, "failed", error=str(exc)[:500], path_status=failed_legs or None)
        return await self._store.get_document(doc_id)

    async def _append_error_marker(self, doc_id: str, marker: str) -> None:
        """Append a visible sub-marker to the document error field without
        clobbering an existing one (e.g. "graph degraded") — degraded stages
        stack their markers, never silently (spec 2026-08-10 D3 降级)."""
        document = await self._store.get_document(doc_id)
        if document is None or marker in (document.get("error") or ""):
            return
        existing = document.get("error") or ""
        error = f"{existing}; {marker}" if existing else marker
        await self._store.update_document_status(doc_id, document["status"], error=error)

    async def _reparse_and_chunk(self, doc_id: str, kb_id: str, storage_path: str) -> None:
        """Parse → caption → chunk, wiping any partial output first (idempotent)."""
        existing = await self._store.list_chunks(doc_id, limit=1_000_000)
        if existing:
            chunk_ids = [chunk["chunk_id"] for chunk in existing]
            orphaned, _affected = await self._graph_store.remove_chunk_contributions(kb_id, chunk_ids)
            if orphaned:
                await self._vector_store.delete_entities(kb_id, orphaned)
            await self._vector_store.delete_by_doc(doc_id)
            await self._store.delete_chunks_by_doc(doc_id)

        await self._store.update_document_status(doc_id, "parsing", path_status={"vector": "pending", "graph": "pending"})
        parsed = await self._parse_fn(storage_path)
        if not parsed.markdown.strip():
            raise EmptyParseResultError("解析结果为空：解析服务（MinerU）未从文档中提取到任何文本（常见于纯标题页、扫描页或内容过短），请重试或改传 .md/.txt 文本版本")
        markdown = parsed.markdown
        if parsed.images:
            captions = await caption_images(parsed.images)
            markdown = apply_captions(markdown, captions)

        await self._require_alive(doc_id)  # checkpoint: after the long external parse, before any write
        if parsed.images:
            # Persist the images the chunk markdown references (``images/…``)
            # so the chunk viewer can serve real files instead of the
            # renderer's broken-image placeholder.
            try:
                await self._save_parsed_images(storage_path, parsed.images)
            except Exception:
                logger.warning("failed to persist parsed images for document %s; continuing without image files", doc_id, exc_info=True)
        await self._store.update_document_status(doc_id, "chunking")
        chunks = chunk_markdown(markdown, doc_id)
        await self._store.insert_chunks(
            [
                {
                    "chunk_id": chunk.chunk_id,
                    "doc_id": doc_id,
                    "kb_id": kb_id,
                    "chunk_index": chunk.chunk_index,
                    "text": chunk.text,
                    "heading_path": chunk.heading_path,
                    "page": chunk.page,
                    "token_count": chunk.token_count,
                }
                for chunk in chunks
            ]
        )
        await self._store.update_document_status(doc_id, "indexing", chunk_count=len(chunks))

    async def _save_parsed_images(self, storage_path: str, images: list[ParsedImage]) -> None:
        """Persist parser-extracted images next to the source document.

        Chunk markdown references them as ``images/…``; the gateway serves them
        from the document directory. Re-parses rebuild the ``images/`` directory
        from scratch so a changed image set never leaves stale files. Refs come
        from the MinerU zip and are re-validated against path traversal anyway.
        """
        doc_dir = Path(storage_path).parent

        def _write() -> None:
            root = doc_dir.resolve()
            images_dir = doc_dir / "images"
            if images_dir.exists():
                shutil.rmtree(images_dir, ignore_errors=True)
            for image in images:
                target = (doc_dir / image.ref).resolve()
                if root not in target.parents:
                    logger.warning("skipping unsafe parsed image ref %r", image.ref)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(image.content)

        await run_file_io(_write)

    async def _maybe_generate_wiki(self, kb_id: str, embedder: _Embedder) -> None:
        """Triggered batch on first completion, dirty incremental afterwards."""
        if self._main_llm is None:
            return
        try:
            if not await wiki_trigger_ready(self._store, kb_id):
                return
            existing = await self._wiki_store.list_entries(kb_id)
            await generate_wiki(
                self._store,
                self._graph_store,
                self._wiki_store,
                self._vector_store,
                kb_id=kb_id,
                llm=self._main_llm,
                embedder=embedder,
                only_dirty=bool(existing),
            )
        except Exception:
            logger.exception("wiki generation trigger failed for kb %s", kb_id)
