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
from .conftest import DOC_ID, KB_ID, OWNER_ID, KeywordEmbedder


class _ConfigRecordingLLM:
    """Captures the invoke config so tests can assert stream-isolation tags."""

    def __init__(self) -> None:
        self.configs: list[dict] = []

    async def ainvoke(self, messages, config=None, **kwargs):
        self.configs.append(config or {})
        return SimpleNamespace(content=json.dumps({"entities": ["x"]}, ensure_ascii=False))


@pytest.mark.asyncio
async def test_extract_query_entities_isolated_from_messages_stream():
    """The extractor is an internal LLM call: without langgraph's TAG_NOSTREAM
    its raw JSON tokens leak onto the run's messages stream and render as an
    assistant message in the UI."""
    from langgraph.constants import TAG_NOSTREAM

    from deerflow.tools.builtins.graph_search_tool import _extract_query_entities

    llm = _ConfigRecordingLLM()
    names = await _extract_query_entities("PDF", llm)

    assert names == ["x"]
    assert llm.configs, "the extractor must invoke the llm"
    tags = llm.configs[0].get("tags") or []
    assert TAG_NOSTREAM in tags, "extractor tokens must stay off the messages stream"


class _QueryLLM:
    """Extracts the keyword found in the query as the entity list."""

    def __init__(self, entities: list[str]) -> None:
        self._entities = entities
        self.calls: list[str] = []

    async def ainvoke(self, messages, **_kwargs):
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
async def test_graph_search_falls_back_to_query_when_extraction_empty(tools_env):
    """Terse entity-only queries ("Gateway") make the LLM extractor flaky — it
    may return {"entities": []}. The query itself must then serve as the
    landing candidate; the cosine floor keeps chit-chat honest."""
    result = await _graph_search_impl(
        "Gateway",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM([])),
    )

    names = {e["name"] for e in result["entities"]}
    assert "Gateway" in names, "query fallback must land on the Gateway entity"
    assert result["evidence"], "the landed entity must surface its source chunks as evidence"


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
        # Phase-1 behaviour restore path: the one-hot keyword embedder makes
        # cross-keyword cosines 0, so the semantic gate must be disabled here.
        neighbor_min_score=0.0,
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


def test_elastic_back_query_method_removed():
    """D4: the channel-3 elastic back-query is gone for good — the vector
    store no longer exposes ``scroll_chunks_by_entities`` (the payload
    ``entities`` tag and its KEYWORD index stay: they feed the chunk-drawer
    display and the future true-mention marker)."""
    from deerflow.knowledge.vector_store import KnowledgeVectorStore

    assert not hasattr(KnowledgeVectorStore, "scroll_chunks_by_entities")


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
        neighbor_min_score=0.0,
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
        neighbor_min_score=0.0,
    )

    # Cosine order: c0/c1 contain the Gateway keyword (1.0), c2 does not (0.0)
    # — guarantee draws c0 then c2, competition appends c1.
    assert [e["chunk_id"] for e in result["evidence"]] == [f"{DOC_ID}-c0", f"{DOC_ID}-c2", f"{DOC_ID}-c1"]


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_prunes_irrelevant_neighbors(tools_env):
    """D2: with the default gate, neighbours orthogonal to the query (cosine 0
    under the one-hot embedder) never enter the seen subgraph."""
    result = await _graph_search_impl(
        "Gateway 和哪些组件交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        **_impl_args(tools_env, _QueryLLM(["Gateway"])),
        neighbor_min_score=0.4,
    )

    assert {e["name"] for e in result["entities"]} == {"Gateway"}
    assert result["relations"] == []  # both edges lose one endpoint to pruning
    assert [e["chunk_id"] for e in result["evidence"]] == [f"{DOC_ID}-c0"]


class _BlendEmbedder(KeywordEmbedder):
    """Query embeddings mentioning DeerFlow get its one-hot dim blended in, so
    the DeerFlow neighbour passes the semantic gate (cosine ≈ 0.57) while
    MinerU stays orthogonal."""

    async def embed(self, texts, *, text_type: str = "document"):
        results = await super().embed(texts, text_type=text_type)
        if text_type == "query":
            for result, text in zip(results, texts, strict=True):
                if "DeerFlow" in text:
                    result.dense[30] = 0.7
        return results


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_graph_search_semantic_gate_keeps_related_neighbor(tools_env):
    """D2: a related neighbour passes the gate, an unrelated one is pruned."""
    result = await _graph_search_impl(
        "DeerFlow 的 Gateway 如何交互？",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        graph_store=tools_env["graph_store"],
        vector_store=tools_env["vector_store"],
        embedder=_BlendEmbedder(),
        llm=_QueryLLM(["Gateway"]),
        neighbor_min_score=0.4,
    )

    assert {e["name"] for e in result["entities"]} == {"Gateway", "DeerFlow"}
    triples = {(r["source"], r["relation"], r["target"]) for r in result["relations"]}
    assert ("DeerFlow", "包含", "Gateway") in triples
    assert ("Gateway", "调用", "MinerU") not in triples  # MinerU pruned
    assert [e["chunk_id"] for e in result["evidence"]] == [f"{DOC_ID}-c0"]
