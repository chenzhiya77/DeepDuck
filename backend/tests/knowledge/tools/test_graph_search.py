"""Tests for graph_search (spec §4.2).

query → local LLM entity extraction → kb_entities vector match → 1–2 hop
expansion → chunk evidence via ``source_chunk_ids`` (precise) plus the
``entities`` payload back-query (elastic). Empty answers stay honest — the
tool must never fabricate graph content.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE
from deerflow.tools.builtins.graph_search_tool import _graph_search_impl

from ..conftest import requires_qdrant
from .conftest import KB_ID, OWNER_ID


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
