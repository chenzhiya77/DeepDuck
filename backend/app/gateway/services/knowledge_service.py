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

from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.parser import SUPPORTED_UPLOAD_SUFFIXES, is_supported_suffix
from deerflow.knowledge.reranker import DashScopeReranker
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.wiki.generator import generate_wiki, wiki_generation_in_progress
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.tools.builtins.graph_search_tool import _graph_search_impl
from deerflow.tools.builtins.hybrid_search_tool import _hybrid_search_impl
from deerflow.tools.builtins.wiki_search_tool import _wiki_search_impl
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

    def trigger_wiki_generation(self, kb_id: str, *, only_dirty: bool = True) -> None:
        """Fire-and-forget wiki generation (Task 14: incremental by default;
        ``only_dirty=False`` rebuilds every eligible entry)."""
        self.wiki_generate_fn(kb_id, only_dirty)

    async def list_wiki_entries(self, kb_id: str) -> list[dict[str, Any]]:
        """Summary-only listing for the wiki tab (phase-2 batch-1).

        Full content stays out of the list payload — the drawer fetches it via
        the detail endpoint. ``summary`` is a plain content prefix.
        """
        entries = await self.wiki_store.list_entries(kb_id)
        return [
            {
                "id": entry["id"],
                "title": entry["title"],
                "summary": entry["content"][:120],
                "status": entry["status"],
                "updated_at": entry["updated_at"],
            }
            for entry in entries
        ]

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
