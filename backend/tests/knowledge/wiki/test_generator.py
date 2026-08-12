"""Tests for the wiki path: head-entity selection, entry generation, dirty refresh (spec §3.5).

Entity-level entries only in Phase 1: the top ~20% entities by degree+frequency
each get one LLM-written entry (main model), whose full text lives in the
``wiki_entries`` table while its dense vector lands in ``kb_wiki_entries``
(payload: entry_id pointer + title + kb_id). A newly indexed doc marks the
affected entries ``dirty``; regeneration rewrites them and clears the flag.
"""

from __future__ import annotations

import zlib
from types import SimpleNamespace

import pytest
from qdrant_client.models import FieldCondition, Filter, MatchValue, SparseVector

from deerflow.knowledge.embedder import EmbeddingResult
from deerflow.knowledge.wiki.generator import (
    WikiStats,
    generate_wiki,
    mark_dirty_for_entities,
    select_head_entities,
    wiki_trigger_ready,
)
from deerflow.knowledge.wiki.store import WikiStore

from ..conftest import requires_qdrant


class _WikiLLM:
    """Writes a deterministic entry mentioning the entity named in the prompt."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def ainvoke(self, messages):
        text = str(messages)
        self.calls.append(text)
        title = "条目"
        for name in ("DeerFlow", "Gateway", "Qdrant", "LangGraph", "MinerU"):
            if f"《{name}》" in text or f"实体：{name}" in text or name in text:
                title = name
                break
        return SimpleNamespace(content=f"# {title}\n\n这是 {title} 的百科综述正文。")


class _StubEmbedder:
    batch_size = 20

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    async def embed(self, texts, *, text_type: str = "document") -> list[EmbeddingResult]:
        self.calls.append(list(texts))
        results = []
        for i, text in enumerate(texts):
            dense = [0.0] * 1024
            dense[zlib.crc32(text.encode("utf-8")) % 1024] = 1.0
            results.append(EmbeddingResult(dense=dense, sparse=SparseVector(indices=[i + 1], values=[0.5])))
        return results


# ── head-entity selection & trigger (pure DB, no Qdrant) ─────────────────────


@pytest.mark.asyncio
async def test_head_entity_selection_top_ratio_by_degree_and_frequency(wiki_db_env):
    graph_store, kb_id = wiki_db_env["graph_store"], wiki_db_env["kb_id"]

    top_20 = await select_head_entities(graph_store, kb_id, top_ratio=0.2)
    assert [e["name"] for e in top_20] == ["DeerFlow"]  # 5 entities → 1 head slot

    top_40 = await select_head_entities(graph_store, kb_id, top_ratio=0.4)
    assert [e["name"] for e in top_40] == ["DeerFlow", "Gateway"]  # scores 5 and 3
    # Rows carry the aggregation inputs for the generator.
    assert set(top_40[0]["source_chunk_ids"]) == {"doc-w-c0", "doc-w-c1"}


@pytest.mark.asyncio
async def test_head_entity_selection_empty_graph(session_factory):
    from deerflow.knowledge.graph.store import GraphStore

    selected = await select_head_entities(GraphStore(session_factory), "kb-void", top_ratio=0.2)
    assert selected == []


@pytest.mark.asyncio
async def test_wiki_trigger_ready_threshold(wiki_db_env):
    store, kb_id, doc_id = wiki_db_env["store"], wiki_db_env["kb_id"], wiki_db_env["doc_id"]

    # Document still indexing → below the 90% completion threshold.
    assert await wiki_trigger_ready(store, kb_id, threshold=0.9) is False

    await store.update_document_status(doc_id, "ready")
    assert await wiki_trigger_ready(store, kb_id, threshold=0.9) is True

    # A KB with no documents never triggers automatically.
    await store.create_kb(kb_id="kb-empty", owner_id="user-1", name="空库")
    assert await wiki_trigger_ready(store, "kb-empty", threshold=0.9) is False


# ── generation + dirty incremental (integration: Qdrant) ─────────────────────


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_generate_wiki_writes_entry_and_vector(wiki_env):
    store, graph_store = wiki_env["store"], wiki_env["graph_store"]
    vector_store, client, kb_id = wiki_env["vector_store"], wiki_env["client"], wiki_env["kb_id"]
    wiki_store = WikiStore(store._sf)
    llm, embedder = _WikiLLM(), _StubEmbedder()

    stats = await generate_wiki(store, graph_store, wiki_store, vector_store, kb_id=kb_id, llm=llm, embedder=embedder, top_ratio=0.4)

    assert isinstance(stats, WikiStats)
    assert stats.selected == 2
    assert stats.generated == 2
    assert sorted(stats.titles) == ["DeerFlow", "Gateway"]

    # wiki_entries rows: full text + ready status + aggregated source chunks.
    entries = await wiki_store.list_entries(kb_id)
    assert len(entries) == 2
    deerflow = next(e for e in entries if e["title"] == "DeerFlow")
    assert deerflow["status"] == "ready"
    assert "百科综述正文" in deerflow["content"]
    assert sorted(deerflow["source_chunk_ids"]) == ["doc-w-c0", "doc-w-c1"]
    # The LLM prompt aggregated the entity's source chunk texts.
    deerflow_prompt = next(call for call in llm.calls if "DeerFlow" in call)
    assert "超级智能体系统" in deerflow_prompt and "存储向量" in deerflow_prompt

    # kb_wiki_entries: dense vector + pointer-only payload (entry_id/title/kb_id).
    points, _ = await client.scroll(
        vector_store.wiki_entries_collection,
        scroll_filter=Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]),
        with_payload=True,
        with_vectors=True,
        limit=10,
    )
    assert len(points) == 2
    payload = next(p for p in points if p.payload["title"] == "DeerFlow").payload
    assert payload["entry_id"] == deerflow["id"]
    assert payload["kb_id"] == kb_id
    assert "content" not in payload  # full text stays in the business DB
    assert embedder.calls, "entry vectors must go through the embedder"


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_new_doc_marks_affected_entries_dirty(wiki_env):
    store, graph_store, wiki_store = wiki_env["store"], wiki_env["graph_store"], WikiStore(wiki_env["store"]._sf)
    kb_id = wiki_env["kb_id"]
    await generate_wiki(store, graph_store, wiki_store, wiki_env["vector_store"], kb_id=kb_id, llm=_WikiLLM(), embedder=_StubEmbedder(), top_ratio=0.4)

    # A newly indexed doc touched DeerFlow → its entry goes dirty, Gateway stays ready.
    marked = await mark_dirty_for_entities(wiki_store, kb_id, ["DeerFlow"])

    assert marked == 1
    entries = {e["title"]: e for e in await wiki_store.list_entries(kb_id)}
    assert entries["DeerFlow"]["status"] == "dirty"
    assert entries["Gateway"]["status"] == "ready"


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_regeneration_clears_dirty_and_only_touches_dirty(wiki_env):
    store, graph_store, vector_store = wiki_env["store"], wiki_env["graph_store"], wiki_env["vector_store"]
    kb_id = wiki_env["kb_id"]
    wiki_store = WikiStore(store._sf)
    await generate_wiki(store, graph_store, wiki_store, vector_store, kb_id=kb_id, llm=_WikiLLM(), embedder=_StubEmbedder(), top_ratio=0.4)
    await mark_dirty_for_entities(wiki_store, kb_id, ["DeerFlow"])

    llm, embedder = _WikiLLM(), _StubEmbedder()
    stats = await generate_wiki(store, graph_store, wiki_store, vector_store, kb_id=kb_id, llm=llm, embedder=embedder, only_dirty=True)

    assert stats.selected == 1
    assert stats.generated == 1
    assert stats.titles == ["DeerFlow"]
    assert len(llm.calls) == 1  # ready entries are NOT regenerated
    entries = {e["title"]: e for e in await wiki_store.list_entries(kb_id)}
    assert entries["DeerFlow"]["status"] == "ready"  # dirty cleared
    assert entries["Gateway"]["status"] == "ready"
    points, _ = await wiki_env["client"].scroll(
        vector_store.wiki_entries_collection,
        scroll_filter=Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]),
        with_payload=True,
        limit=10,
    )
    assert len(points) == 2  # re-upsert overwrote in place, no duplicates


@pytest.mark.asyncio
async def test_empty_graph_generates_nothing(session_factory):
    from deerflow.knowledge.graph.store import GraphStore
    from deerflow.knowledge.store import KnowledgeStore

    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-void", owner_id="user-1", name="空库")
    llm = _WikiLLM()

    stats = await generate_wiki(store, GraphStore(session_factory), WikiStore(session_factory), None, kb_id="kb-void", llm=llm, embedder=None)

    assert stats.selected == 0 and stats.generated == 0
    assert llm.calls == []


# ── Task 5b: incremental targets = dirty ∪ (current heads without an entry) ───


@pytest.mark.asyncio
async def test_only_dirty_backfills_newly_promoted_head(wiki_db_env):
    """A head entity with no entry yet gets one even when nothing is dirty —
    new content must not wait for a manual full regeneration (spec §3.5
    2026-08-12 revision). Pure-DB: no vector store needed for the target set."""
    store, graph_store, kb_id = wiki_db_env["store"], wiki_db_env["graph_store"], wiki_db_env["kb_id"]
    wiki_store = WikiStore(store._sf)
    # First batch with a narrower head slice: only DeerFlow gets an entry.
    await generate_wiki(store, graph_store, wiki_store, None, kb_id=kb_id, llm=_WikiLLM(), top_ratio=0.2)
    assert {e["title"] for e in await wiki_store.list_entries(kb_id)} == {"DeerFlow"}

    # Gateway is promoted into the head slice (a re-ranked graph widens the
    # head — proxied here by a larger ratio). Nothing is dirty; the backfill
    # must still write Gateway's entry.
    llm = _WikiLLM()
    stats = await generate_wiki(store, graph_store, wiki_store, None, kb_id=kb_id, llm=llm, top_ratio=0.4, only_dirty=True)

    assert stats.selected == 1
    assert stats.generated == 1
    assert stats.titles == ["Gateway"]
    assert len(llm.calls) == 1
    # After the backfill the entry set matches the current head slice exactly.
    heads = {row["name"] for row in await select_head_entities(graph_store, kb_id, top_ratio=0.4)}
    entries = {e["title"]: e for e in await wiki_store.list_entries(kb_id)}
    assert set(entries) == heads == {"DeerFlow", "Gateway"}
    assert all(entry["status"] == "ready" for entry in entries.values())


@pytest.mark.asyncio
async def test_only_dirty_idempotent_and_demoted_heads_retained(wiki_db_env):
    """Existing entries are never re-written (idempotent); entities demoted
    out of the head slice keep their entries (never deleted)."""
    store, graph_store, kb_id = wiki_db_env["store"], wiki_db_env["graph_store"], wiki_db_env["kb_id"]
    wiki_store = WikiStore(store._sf)
    await generate_wiki(store, graph_store, wiki_store, None, kb_id=kb_id, llm=_WikiLLM(), top_ratio=0.4)

    # Idempotent: every head already has an entry and nothing is dirty → no work.
    llm = _WikiLLM()
    stats = await generate_wiki(store, graph_store, wiki_store, None, kb_id=kb_id, llm=llm, top_ratio=0.4, only_dirty=True)
    assert stats.selected == 0 and stats.generated == 0
    assert llm.calls == []

    # Demotion: the head slice narrows to DeerFlow — Gateway's entry is kept.
    stats = await generate_wiki(store, graph_store, wiki_store, None, kb_id=kb_id, llm=llm, top_ratio=0.2, only_dirty=True)
    assert stats.generated == 0
    assert llm.calls == []
    entries = {e["title"]: e for e in await wiki_store.list_entries(kb_id)}
    assert set(entries) == {"DeerFlow", "Gateway"}
    assert entries["Gateway"]["status"] == "ready"
