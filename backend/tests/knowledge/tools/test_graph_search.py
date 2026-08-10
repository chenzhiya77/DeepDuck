"""Tests for graph_search (spec §4.2 + 2026-08-10 phase-2 D1).

query → local LLM entity extraction → kb_entities vector match → 1–2 hop
expansion → chunk evidence via ``source_chunk_ids`` (precise), ranked by
semantic scores (guarantee-plus-competition). Empty answers stay honest —
the tool must never fabricate graph content.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE
from deerflow.knowledge.graph.extractor import ExtractedEntity
from deerflow.knowledge.reranker import RerankerError
from deerflow.tools.builtins.graph_search_tool import _graph_search_impl

from ..conftest import requires_qdrant
from .conftest import DOC_ID, KB_ID, OWNER_ID


class _QueryLLM:
    """Extracts the keyword found in the query as the entity list."""

    def __init__(self, entities: list[str]) -> None:
        self._entities = entities
        self.calls: list[str] = []

    async def ainvoke(self, messages):
        self.calls.append(str(messages))
        return SimpleNamespace(content=json.dumps({"entities": self._entities}, ensure_ascii=False))


def _runtime(**context) -> SimpleNamespace:
    return SimpleNamespace(context=context)


class _FixedReranker:
    """Returns a caller-fixed (index, score) order regardless of content."""

    def __init__(self, order: list[tuple[int, float]]) -> None:
        self._order = order

    async def rerank(self, query, documents, *, top_n: int = 5):
        return self._order[:top_n]


class _FailingReranker:
    async def rerank(self, query, documents, *, top_n: int = 5):
        raise RerankerError("boom")


def _impl_args(tools_env, llm):
    return dict(
        store=tools_env["store"],
        graph_store=tools_env["graph_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
        llm=llm,
    )


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_expands_and_fetches_evidence(tools_env):
    llm = _QueryLLM(["Gateway"])

    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        graph_store=tools_env["graph_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
        llm=llm,
        hops=2,
    )

    # Matched entity plus its 1-2 hop neighborhood.
    entity_names = {e["name"] for e in result["entities"]}
    assert "Gateway" in entity_names
    assert {"DeerFlow", "MinerU"} <= entity_names  # 1-hop both directions
    triples = {(r["source"], r["relation"], r["target"]) for r in result["relations"]}
    assert ("DeerFlow", "包含", "Gateway") in triples
    assert ("Gateway", "调用", "MinerU") in triples

    # Evidence: chunk text from the business DB with citation metadata.
    texts = [e["text"] for e in result["evidence"]]
    assert any("会话管理" in t for t in texts)
    assert any("文档解析" in t for t in texts)
    sample = result["evidence"][0]
    assert {"chunk_id", "text", "doc_name", "heading_path", "page"} <= set(sample)
    assert sample["doc_name"] == "架构.md"


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_honest_when_nothing_matches(tools_env):
    llm = _QueryLLM(["不存在的实体XYZ"])

    result = await _graph_search_impl(
        "不存在的实体XYZ 是什么？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        graph_store=tools_env["graph_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
        llm=llm,
    )

    assert result["entities"] == []
    assert result["relations"] == []
    assert result["evidence"] == []
    assert "未" in result["message"] or "没有" in result["message"]  # never fabricate


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_empty_query_entities(tools_env):
    llm = _QueryLLM([])

    result = await _graph_search_impl(
        "随便聊聊",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        graph_store=tools_env["graph_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
        llm=llm,
    )

    assert result["entities"] == []
    assert result["evidence"] == []


@pytest.mark.asyncio
async def test_graph_search_without_kb_returns_guidance(session_factory):
    from deerflow.knowledge.graph.store import GraphStore
    from deerflow.knowledge.store import KnowledgeStore

    result = await _graph_search_impl(
        "任意",
        _runtime(user_id=OWNER_ID),
        store=KnowledgeStore(session_factory),
        graph_store=GraphStore(session_factory),
        vector_store=None,
        embedder=None,
        llm=_QueryLLM([]),
    )
    assert result["evidence"] == []
    assert result["message"] == NO_KB_GUIDANCE


@pytest.mark.asyncio
async def test_graph_search_denies_non_owner(session_factory):
    from deerflow.knowledge.graph.store import GraphStore
    from deerflow.knowledge.store import KnowledgeStore

    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-x", owner_id=OWNER_ID, name="私有")

    result = await _graph_search_impl(
        "任意",
        _runtime(kb_id="kb-x", user_id="user-2"),
        store=store,
        graph_store=GraphStore(session_factory),
        vector_store=None,
        embedder=None,
        llm=_QueryLLM([]),
    )
    assert result["evidence"] == []
    assert result["message"] == ACCESS_DENIED_MESSAGE


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_evidence_carries_scores(tools_env):
    """D1: every evidence item carries the raw score of the scoring channel
    (embedding cosine by default) for recall-test / frontend debugging."""
    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM(["Gateway"])),
    )

    assert result["evidence"]
    for item in result["evidence"]:
        assert isinstance(item["score"], float)


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_never_calls_elastic_back_query(tools_env, monkeypatch):
    """D4 (call-side): the channel-3 ``entities`` payload back-query is gone —
    patching it to raise must not affect the search at all."""

    async def _forbidden(*args, **kwargs):
        raise AssertionError("elastic back-query must not be called (channel 3 removed)")

    monkeypatch.setattr(tools_env["vector_store"], "scroll_chunks_by_entities", _forbidden)

    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM(["Gateway"])),
    )

    texts = [e["text"] for e in result["evidence"]]
    assert any("会话管理" in t for t in texts)
    assert any("文档解析" in t for t in texts)


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_reranker_decides_order_when_enabled(tools_env):
    """D1 optional precision pass: with graph_rerank on and candidates above
    the threshold, the reranker score decides the evidence order."""
    # Give Gateway a second birth-certificate chunk so its guarantee queue
    # holds two slices and the rerank order becomes observable.
    await tools_env["graph_store"].upsert_entities(
        KB_ID,
        [ExtractedEntity(name="Gateway", type="组件", description="会话管理入口")],
        chunk_id=f"{DOC_ID}-c2",
    )
    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM(["Gateway"])),
        reranker=_FixedReranker([(2, 0.99), (1, 0.5), (0, 0.01)]),
        graph_rerank=True,
        rerank_threshold=1,
    )

    assert [e["chunk_id"] for e in result["evidence"]] == [f"{DOC_ID}-c2", f"{DOC_ID}-c0", f"{DOC_ID}-c1"]
    assert result["evidence"][0]["score"] == pytest.approx(0.99)


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_reranker_error_falls_back_to_embedding_order(tools_env):
    """D1 degradation: RerankerError falls back to the embedding-cosine order
    instead of failing the search."""
    await tools_env["graph_store"].upsert_entities(
        KB_ID,
        [ExtractedEntity(name="Gateway", type="组件", description="会话管理入口")],
        chunk_id=f"{DOC_ID}-c2",
    )
    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM(["Gateway"])),
        reranker=_FailingReranker(),
        graph_rerank=True,
        rerank_threshold=1,
    )

    # Cosine order: c0/c1 contain the Gateway keyword (1.0), c2 does not (0.0)
    # — guarantee draws c0 then c2, competition appends c1.
    assert [e["chunk_id"] for e in result["evidence"]] == [f"{DOC_ID}-c0", f"{DOC_ID}-c2", f"{DOC_ID}-c1"]
