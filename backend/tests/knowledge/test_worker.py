"""Tests for the async indexing worker (spec §3.6/§3.7).

The worker drives one document through the status machine
``uploaded → parsing → chunking → indexing → ready`` (or ``failed`` with the
error persisted), persists ``progress_percent`` as graph-settled/total chunks,
caps concurrency with a semaphore, and on startup re-enqueues non-terminal
documents — the slice-level extract state machine guarantees resumed runs
never re-extract ``done`` chunks.

Tests run fully offline: fake parser/LLM/embedder, a mocked vector store, and
a real SQLite database (slice status persistence is the point under test).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.models import SparseVector

from deerflow.knowledge.embedder import EmbeddingResult
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.parser import ParsedDocument
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.knowledge.worker import KnowledgeIndexWorker

SAMPLE_MD = """# 第一章 概述

DeerFlow 是超级智能体系统，Gateway 负责会话管理。

## 1.1 架构

索引流水线由 Parser 与 Chunker 组成，Chunker 按标题切片。
"""


class FakeEmbedder:
    batch_size = 20

    async def embed(self, texts, *, text_type: str = "document"):
        return [EmbeddingResult(dense=[0.01 * (i + 1)] * 1024, sparse=SparseVector(indices=[i + 1], values=[0.5])) for i, _ in enumerate(texts)]


class FakeLLM:
    """One canned extraction payload per unique text (keyed by first chars)."""

    def __init__(self, mapping: dict[str, dict]) -> None:
        self.mapping = mapping
        self.seen_texts: list[str] = []

    async def ainvoke(self, messages):
        last = messages[-1] if isinstance(messages, list) else messages
        text = last["content"] if isinstance(last, dict) else getattr(last, "content", str(last))
        text = str(text)
        # gleaning follow-ups ("是否有遗漏") answer empty so extraction settles
        if "遗漏" in text:
            return SimpleNamespace(content='{"entities": [], "relations": []}')
        self.seen_texts.append(text)
        for key, payload in self.mapping.items():
            if key in text:
                return SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))
        return SimpleNamespace(content='{"entities": [], "relations": []}')


def _vector_store_mock() -> MagicMock:
    vs = MagicMock()
    vs.init_collections = AsyncMock()
    vs.upsert_chunks = AsyncMock(return_value=0)
    vs.upsert_entities = AsyncMock(return_value=0)
    vs.set_chunk_entities = AsyncMock()
    vs.delete_by_doc = AsyncMock()
    vs.delete_entities = AsyncMock()
    vs.upsert_wiki_entries = AsyncMock(return_value=0)
    vs.get_entity_vectors = AsyncMock(return_value={})
    return vs


def _parse_fn(md: str = SAMPLE_MD, fail: Exception | None = None, seen_statuses: list[str] | None = None, store: KnowledgeStore | None = None, doc_id: str | None = None):
    async def _parse(path: str) -> ParsedDocument:
        if fail is not None:
            raise fail
        if seen_statuses is not None and store is not None and doc_id is not None:
            doc = await store.get_document(doc_id)
            seen_statuses.append(doc["status"])
        return ParsedDocument(markdown=md, images=[])

    return _parse


def _worker(store, session_factory, **kwargs) -> KnowledgeIndexWorker:
    kwargs.setdefault("vector_store", _vector_store_mock())
    kwargs.setdefault("embedder", FakeEmbedder())
    kwargs.setdefault("concurrency", 2)
    return KnowledgeIndexWorker(store=store, **kwargs)


@pytest.mark.asyncio
async def test_pipeline_advances_status_machine_to_ready(session_factory):
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=10, storage_path="/tmp/a.md")
    llm = FakeLLM({"DeerFlow": {"entities": [{"name": "DeerFlow", "type": "系统", "description": "框架"}], "relations": []}})
    seen: list[str] = []
    worker = _worker(store, session_factory, parse_fn=_parse_fn(seen_statuses=seen, store=store, doc_id="doc-1"), llm=llm)

    await worker.process_document("doc-1")

    doc = await store.get_document("doc-1")
    assert doc["status"] == "ready"
    assert doc["progress_percent"] == 100
    # both heading blocks are small (<100 tokens) so the chunker merges them into one
    assert doc["chunk_count"] == 1
    assert seen == ["parsing"], "parse must run after the status advances to parsing"
    chunks = await store.list_chunks("doc-1", limit=10)
    assert {c["extract_status"] for c in chunks} == {"done"}
    assert any("DeerFlow" in (c["entities"] or []) for c in chunks)
    # vector path wrote chunk points + graph path backfilled payload + entities
    assert worker._vector_store.upsert_chunks.await_count >= 1
    assert worker._vector_store.set_chunk_entities.await_count == 1
    assert worker._vector_store.upsert_entities.await_count == 1
    # graph store persisted the entity
    graph = await GraphStore(session_factory).load_networkx("kb-1")
    assert "DeerFlow" in graph.nodes


@pytest.mark.asyncio
async def test_parse_failure_marks_failed_with_error(session_factory):
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="bad.pdf", size_bytes=10, storage_path="/tmp/bad.pdf")
    worker = _worker(store, session_factory, parse_fn=_parse_fn(fail=RuntimeError("MinerU 服务不可用")))

    await worker.process_document("doc-1")

    doc = await store.get_document("doc-1")
    assert doc["status"] == "failed"
    assert "MinerU 服务不可用" in (doc["error"] or "")


@pytest.mark.asyncio
async def test_progress_percent_tracks_graph_settled_chunks(session_factory):
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=10, storage_path="/tmp/a.md")
    llm = FakeLLM({})
    worker = _worker(store, session_factory, parse_fn=_parse_fn(), llm=llm)
    progress_calls: list[int] = []
    original = store.update_document_status

    async def spy(doc_id, status, **kwargs):
        if "progress_percent" in kwargs and kwargs["progress_percent"] is not None:
            progress_calls.append(kwargs["progress_percent"])
        return await original(doc_id, status, **kwargs)

    store.update_document_status = spy  # type: ignore[method-assign]

    await worker.process_document("doc-1")

    assert progress_calls, "graph progress callback must persist progress_percent"
    assert progress_calls == sorted(progress_calls), "progress must be monotonic"
    assert progress_calls[-1] == 100


@pytest.mark.asyncio
async def test_concurrency_cap_respected(session_factory):
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    for i in range(3):
        await store.create_document(doc_id=f"doc-{i}", kb_id="kb-1", uploader_id="user-1", name=f"{i}.md", size_bytes=1, storage_path=f"/tmp/{i}.md")

    active = 0
    peak = 0

    async def slow_parse(path: str) -> ParsedDocument:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            import asyncio

            await asyncio.sleep(0.01)
            return ParsedDocument(markdown="# 标题\n\n正文。", images=[])
        finally:
            active -= 1

    worker = _worker(store, session_factory, parse_fn=slow_parse, llm=FakeLLM({}), concurrency=1)
    await worker.start()
    for i in range(3):
        await worker.submit(f"doc-{i}")
    await worker.wait_idle()
    await worker.stop()

    assert peak == 1
    for i in range(3):
        assert (await store.get_document(f"doc-{i}"))["status"] == "ready"


@pytest.mark.asyncio
async def test_startup_recovery_skips_terminal_and_done_chunks(session_factory):
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    # doc-A crashed mid-indexing: one chunk extracted, one still pending
    await store.create_document(doc_id="doc-a", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=1, storage_path="/tmp/a.md")
    await store.update_document_status("doc-a", "indexing", chunk_count=2)
    await store.insert_chunks(
        [
            {"chunk_id": "doc-a#0000", "doc_id": "doc-a", "kb_id": "kb-1", "chunk_index": 0, "text": "已完成切片", "heading_path": [], "page": None, "token_count": 5},
            {"chunk_id": "doc-a#0001", "doc_id": "doc-a", "kb_id": "kb-1", "chunk_index": 1, "text": "待抽取切片 DeerFlow", "heading_path": [], "page": None, "token_count": 5},
        ]
    )
    await store.update_chunk_extract("doc-a#0000", "done", entities=["DeerFlow"])
    # doc-B already terminal — recovery must not touch it
    await store.create_document(doc_id="doc-b", kb_id="kb-1", uploader_id="user-1", name="b.md", size_bytes=1, storage_path="/tmp/b.md")
    await store.update_document_status("doc-b", "ready", progress_percent=100, chunk_count=1)

    llm = FakeLLM({"DeerFlow": {"entities": [{"name": "DeerFlow", "type": "系统", "description": "框架"}], "relations": []}})
    worker = _worker(store, session_factory, llm=llm)
    await worker.start()
    await worker.wait_idle()
    await worker.stop()

    doc_a = await store.get_document("doc-a")
    assert doc_a["status"] == "ready"
    assert doc_a["progress_percent"] == 100
    chunk0 = {c["chunk_id"]: c for c in await store.list_chunks("doc-a", limit=10)}["doc-a#0000"]
    assert chunk0["extract_status"] == "done"
    # the pending chunk was extracted exactly once; the done chunk never re-sent to the LLM
    assert len(llm.seen_texts) == 1
    assert "待抽取切片" in llm.seen_texts[0]
    # terminal doc untouched (parse_fn default would fail loudly if invoked — none was provided)
    assert (await store.get_document("doc-b"))["status"] == "ready"


class _WikiLLM:
    """Main-model fake for wiki entry generation."""

    async def ainvoke(self, messages):
        return SimpleNamespace(content="# DeerFlow\n\nDeerFlow 是基于 LangGraph 的超级智能体系统，包含 Gateway 与沙箱。")


@pytest.mark.asyncio
async def test_ready_document_auto_triggers_wiki_generation(session_factory):
    """Regression: the auto wiki trigger must use the real WikiStore interface.

    Live smoke caught ``_maybe_generate_wiki`` calling ``wiki_store.list()``
    (the real method is ``list_entries``) — with a mocked wiki store the slip
    was invisible, and the trigger silently produced nothing.
    """
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=10, storage_path="/tmp/a.md")
    llm = FakeLLM({"DeerFlow": {"entities": [{"name": "DeerFlow", "type": "系统", "description": "框架"}], "relations": []}})
    worker = _worker(store, session_factory, parse_fn=_parse_fn(), llm=llm, main_llm=_WikiLLM())

    await worker.process_document("doc-1")

    assert (await store.get_document("doc-1"))["status"] == "ready"
    entries = await WikiStore(session_factory).list_entries("kb-1")
    assert entries, "auto wiki trigger produced no entries"
    assert entries[0]["title"] == "DeerFlow"
    assert entries[0]["status"] == "ready"
    assert worker._vector_store.upsert_wiki_entries.await_count == 1


@pytest.mark.asyncio
async def test_entity_resolution_runs_after_graph_indexing(session_factory, monkeypatch):
    """D3: the worker triggers the incremental re-resolution with the touched
    entity set right after the graph leg, before marking the document ready."""
    from deerflow.knowledge.graph.resolver import ResolutionStats

    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=10, storage_path="/tmp/a.md")
    llm = FakeLLM({"DeerFlow": {"entities": [{"name": "DeerFlow", "type": "系统", "description": "框架"}], "relations": []}})
    spy = AsyncMock(return_value=ResolutionStats())
    monkeypatch.setattr("deerflow.knowledge.worker.resolve_entity_aliases", spy)
    worker = _worker(store, session_factory, parse_fn=_parse_fn(), llm=llm)

    await worker.process_document("doc-1")

    assert (await store.get_document("doc-1"))["status"] == "ready"
    assert spy.await_count == 1
    assert spy.await_args.kwargs["kb_id"] == "kb-1"
    assert spy.await_args.kwargs["touched_entities"] == {"DeerFlow"}


class _PartialFailLLM:
    """First chunk extracts fine, the '坏切片' chunk returns malformed JSON."""

    async def ainvoke(self, messages):
        last = messages[-1] if isinstance(messages, list) else messages
        text = str(last["content"] if isinstance(last, dict) else getattr(last, "content", last))
        if "遗漏" in text:
            return SimpleNamespace(content='{"entities": [], "relations": []}')
        if "坏切片" in text:
            return SimpleNamespace(content="这不是 JSON")
        return SimpleNamespace(content=json.dumps({"entities": [{"name": "DeerFlow", "type": "系统", "description": "框架"}], "relations": []}, ensure_ascii=False))


@pytest.mark.asyncio
async def test_entity_resolution_failure_degrades_without_blocking(session_factory, monkeypatch):
    """D3: a failing re-resolution never blocks the pipeline — the document
    still reaches ``ready`` and the error field gains a visible sub-marker
    alongside any existing ``graph degraded`` flag; wiki generation proceeds."""
    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-1", owner_id="user-1", name="k")
    await store.create_document(doc_id="doc-1", kb_id="kb-1", uploader_id="user-1", name="a.md", size_bytes=10, storage_path="/tmp/a.md")
    await store.update_document_status("doc-1", "indexing", chunk_count=2)
    await store.insert_chunks(
        [
            {"chunk_id": "doc-1#0000", "doc_id": "doc-1", "kb_id": "kb-1", "chunk_index": 0, "text": "DeerFlow 智能体", "heading_path": [], "page": None, "token_count": 5},
            {"chunk_id": "doc-1#0001", "doc_id": "doc-1", "kb_id": "kb-1", "chunk_index": 1, "text": "坏切片", "heading_path": [], "page": None, "token_count": 5},
        ]
    )
    monkeypatch.setattr("deerflow.knowledge.worker.resolve_entity_aliases", AsyncMock(side_effect=RuntimeError("resolution boom")))
    worker = _worker(store, session_factory, llm=_PartialFailLLM(), main_llm=_WikiLLM())

    await worker.process_document("doc-1")

    doc = await store.get_document("doc-1")
    assert doc["status"] == "ready"
    assert "graph degraded" in doc["error"]  # 1/2 chunks failed > 30%
    assert "entity-resolution failed" in doc["error"]
    entries = await WikiStore(session_factory).list_entries("kb-1")
    assert entries, "wiki generation must not be blocked by the resolution failure"
