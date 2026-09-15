"""Contract tests for POST /api/knowledge-bases/{kb_id}/recall-test (P1).

The endpoint fans one query out to the three retrieval paths by reusing the
online tools' own ``_*_impl`` functions — no LLM answer synthesis, raw hits +
scores + per-path elapsed. Unit tests mock the impls at the service-module
boundary; the requires_qdrant integration test runs the real impls against
the seeded ``tools_env`` fixture and checks parity with direct impl calls.
"""

from __future__ import annotations

import json
import uuid
from functools import partial
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from _router_auth_helpers import make_authed_test_app
from fastapi.testclient import TestClient

import deerflow.config.app_config as app_config_module
from app.gateway.auth.models import User
from app.gateway.routers import knowledge_bases
from app.gateway.services import knowledge_service as ks_module
from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.store import KnowledgeStore
from deerflow.tools.builtins.graph_search_tool import _graph_search_impl
from deerflow.tools.builtins.hybrid_search_tool import _hybrid_search_impl
from deerflow.tools.builtins.wiki_search_tool import _wiki_search_impl

from .conftest import requires_qdrant
from .tools.conftest import KB_ID as TOOLS_KB_ID
from .tools.conftest import OWNER_ID as TOOLS_OWNER_ID
from .tools.conftest import tools_env  # noqa: F401 — re-exported as a fixture

pytestmark = pytest.mark.asyncio

OWNER_ID = str(uuid.UUID(int=1234567890))


def _owner() -> User:
    return User(email="owner@example.com", password_hash="x", system_role="user", id=uuid.UUID(OWNER_ID))


def _stranger() -> User:
    return User(email="stranger@example.com", password_hash="x", system_role="user", id=uuid.UUID(int=987654321))


@pytest.fixture
def service(session_factory, tmp_path) -> KnowledgeService:
    vector_store = MagicMock()
    vector_store.delete_by_doc = AsyncMock()
    vector_store.delete_by_kb = AsyncMock()
    vector_store.delete_entities = AsyncMock()
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=None,
        worker=None,
        data_dir=tmp_path,
    )


def _client(service: KnowledgeService, user_factory=_owner) -> TestClient:
    app = make_authed_test_app(user_factory=user_factory)
    app.state.knowledge_service = service
    app.include_router(knowledge_bases.router)
    return TestClient(app)


@pytest.fixture
def service_with_wiki(session_factory, tmp_path) -> KnowledgeService:
    """带 wiki_store 的服务——`source_chunk_ids` 注入用例需要 `get_entry`（spec 2026-08-28 §5）。"""
    vector_store = MagicMock()
    vector_store.delete_by_doc = AsyncMock()
    vector_store.delete_by_kb = AsyncMock()
    vector_store.delete_entities = AsyncMock()
    wiki_store = MagicMock()
    wiki_store.get_entry = AsyncMock(return_value={"id": "e1", "source_chunk_ids": ["doc1#0001", "doc1#0003"]})
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=wiki_store,
        worker=None,
        data_dir=tmp_path,
    )


def _create_kb(client: TestClient, name: str = "产品资料") -> dict:
    response = client.post("/api/knowledge-bases", json={"name": name, "description": "d"})
    assert response.status_code == 201, response.text
    return response.json()


def _mock_impls(monkeypatch) -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    vector = AsyncMock(
        return_value={
            "results": [
                {"chunk_id": "c1", "text": "切片一", "doc_name": "架构.md", "page": 1, "heading_path": ["架构"], "score": 0.97},
                # rerank 降级形态：无 score 键 → 响应必须显式给 null（schema 可空）
                {"chunk_id": "c2", "text": "切片二", "doc_name": "架构.md", "page": 2, "heading_path": []},
            ],
            "message": "检索到 2 条相关切片。（精排服务暂不可用，已按混合检索粗排顺序返回）",
        }
    )
    graph = AsyncMock(
        return_value={
            "entities": [{"name": "Gateway", "type": "组件", "description": "入口"}],
            "relations": [{"source": "DeerFlow", "target": "Gateway", "relation": "包含", "description": ""}],
            "evidence": [{"chunk_id": "c1", "text": "切片一", "doc_name": "架构.md", "heading_path": ["架构"], "page": 1, "score": 0.88}],
            "message": "命中 1 个实体，扩展出 1 个节点、1 条关系、1 条切片证据。",
        }
    )
    wiki = AsyncMock(
        return_value={
            "entries": [
                {"entry_id": "e1", "title": "DeerFlow", "content": "长" * 200, "score": 0.91, "updated_at": "2026-08-10T00:00:00"},
                # Phase-3 P6（spec §8 混排）：wiki 路现在可能命中人工卡片，
                # impl 逐条带 source_type；旧形态（无该键）回退 "wiki"。
                {"entry_id": "card-1", "title": "发布禁令", "content": "周五下午不发布", "score": 0.85, "source_type": "manual"},
            ],
            "message": "命中 1 篇百科条目、1 张人工知识卡片。",
        }
    )
    monkeypatch.setattr(ks_module, "_hybrid_search_impl", vector)
    monkeypatch.setattr(ks_module, "_graph_search_impl", graph)
    monkeypatch.setattr(ks_module, "_wiki_search_impl", wiki)
    return vector, graph, wiki


async def test_recall_test_assembles_three_paths(service, monkeypatch):
    vector, graph, wiki = _mock_impls(monkeypatch)
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "Gateway 职责", "top_k": 7})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["query"] == "Gateway 职责"

    vhits = body["paths"]["vector"]["hits"]
    assert [hit["rank"] for hit in vhits] == [1, 2]
    assert vhits[0]["chunk_id"] == "c1"
    assert vhits[0]["score"] == 0.97
    assert vhits[1]["score"] is None, "rerank 降级时 score 必须显式为 null（schema 可空）"
    assert body["paths"]["vector"]["message"].startswith("检索到 2 条")

    graph_path = body["paths"]["graph"]
    assert graph_path["entities"][0]["name"] == "Gateway"
    assert graph_path["relations"][0]["relation"] == "包含"
    assert graph_path["evidence"][0]["score"] == 0.88

    whits = body["paths"]["wiki"]["hits"]
    assert whits[0]["entry_id"] == "e1"
    assert whits[0]["title"] == "DeerFlow"
    assert whits[0]["summary"] == "长" * 120, "wiki summary 截断 120 字符（与列表端点同口径）"
    assert whits[0]["score"] == 0.91
    assert whits[0]["rank"] == 1
    assert "content" not in whits[0], "wiki 命中不返回全文"
    # Phase-3 P6：source_type 透传（旧形态缺键回退 wiki），前端据此分
    # 流「百科条目抽屉 / 人工卡片抽屉」——卡片 id 走 wiki 详情接口必然 404。
    assert whits[0]["source_type"] == "wiki"
    assert whits[1]["source_type"] == "manual"
    assert whits[1]["entry_id"] == "card-1"
    assert whits[1]["rank"] == 2
    # 构造器保证 wiki_store 非 None（真实 WikiStore）——库中不存在的词条 →
    # 空数组（锚定不可用但不影响浏览）；人工卡片不注入此键。
    assert whits[0]["source_chunk_ids"] == []
    assert "source_chunk_ids" not in whits[1]

    assert body["score_type"] == {
        "vector": "qwen3-rerank relevance",
        # 2026-09-05：图谱路胶囊去掉「（当次可比）」补注——与 wiki 路同串。
        "graph": "embedding cosine",
        "wiki": "embedding cosine",
    }
    assert set(body["elapsed_ms"]) == {"vector", "graph", "wiki"}
    assert all(isinstance(value, int) and value >= 0 for value in body["elapsed_ms"].values())

    # top_k 映射：vector/wiki 直通，graph 映射 evidence_limit
    assert vector.call_args.kwargs["top_k"] == 7
    assert graph.call_args.kwargs["evidence_limit"] == 7
    assert wiki.call_args.kwargs["top_k"] == 7
    # runtime 构造：SimpleNamespace(context={kb_id, user_id})
    for impl in (vector, graph, wiki):
        runtime = impl.call_args.args[1]
        assert runtime.context == {"kb_id": kb["id"], "user_id": OWNER_ID}


async def test_recall_test_injects_chunk_position_in_drawer_order(service, monkeypatch):
    """切片文档内序号（2026-09-05）：命中带 chunk_position = 文档存活切片中
    的位次（chunk_index 升序），与切片总览抽屉 #K 位置序同源；空洞（已删
    切片）不占位。畸形 chunk_id（无 #NNNN 后缀）不注入该键。"""
    vector, graph, _wiki = _mock_impls(monkeypatch)
    client = _client(service)
    kb = _create_kb(client)
    doc_id = "d" * 32
    await service.store.create_document(doc_id=doc_id, kb_id=kb["id"], uploader_id=OWNER_ID, name="hole.md", size_bytes=1, storage_path="p")
    # 存活 chunk_index = {0, 1, 3}：#0002 已删 → #0003 的位次是 3（不是 4）
    await service.store.insert_chunks([{"chunk_id": f"{doc_id}#000{i}", "doc_id": doc_id, "kb_id": kb["id"], "chunk_index": i, "text": text} for i, text in [(0, "a"), (1, "b"), (3, "d")]])
    vector.return_value = {
        "results": [
            {"chunk_id": f"{doc_id}#0001", "text": "b", "doc_name": "hole.md", "page": None, "heading_path": [], "score": 0.9},
            {"chunk_id": f"{doc_id}#0003", "text": "d", "doc_name": "hole.md", "page": None, "heading_path": [], "score": 0.8},
            {"chunk_id": "c1", "text": "畸形 id", "doc_name": "x.md", "page": None, "heading_path": [], "score": 0.7},
        ],
        "message": "命中 3 条。",
    }
    graph.return_value = {
        "entities": [],
        "relations": [],
        "evidence": [{"chunk_id": f"{doc_id}#0003", "text": "d", "doc_name": "hole.md", "heading_path": [], "page": None, "score": 0.8}],
        "message": "命中 1 条证据。",
    }

    response = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "hole"})
    assert response.status_code == 200, response.text
    body = response.json()
    vhits = body["paths"]["vector"]["hits"]
    assert [vhits[0]["chunk_position"], vhits[1]["chunk_position"]] == [2, 3]
    assert "chunk_position" not in vhits[2]
    assert body["paths"]["graph"]["evidence"][0]["chunk_position"] == 3


async def test_recall_test_single_path_failure_degrades(service, monkeypatch):
    vector, _graph, _wiki = _mock_impls(monkeypatch)
    vector.side_effect = RuntimeError("qdrant down")
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "x"})
    assert response.status_code == 200, "单路异常不得拖垮整响应"
    body = response.json()
    assert body["paths"]["vector"]["hits"] == []
    assert "失败" in body["paths"]["vector"]["message"]
    assert "RuntimeError" in body["paths"]["vector"]["message"]
    assert body["paths"]["graph"]["entities"], "其他路不受影响"
    assert body["paths"]["wiki"]["hits"]
    assert isinstance(body["elapsed_ms"]["vector"], int), "失败路仍计时"


# ── wiki 锚定通道（spec 2026-08-28 §5）─────────────────────────────────


async def test_wiki_hits_carry_source_chunk_ids_for_anchoring(service_with_wiki, monkeypatch):
    # 百科词条命中带源切片——前端勾选百科行即可锚定（与 runner.wiki_fn 同源读取）。
    _mock_impls(monkeypatch)
    client = _client(service_with_wiki)
    kb = _create_kb(client)

    body = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "Gateway 职责"}).json()

    whits = body["paths"]["wiki"]["hits"]
    assert whits[0]["source_chunk_ids"] == ["doc1#0001", "doc1#0003"]
    # 人工卡片无切片映射——不注入此键（与 runner.wiki_fn 跳过卡片的口径一致），前端据此禁勾。
    assert "source_chunk_ids" not in whits[1]
    # 只查词条不查卡片（不为人工卡片白打 get_entry）。
    service_with_wiki.wiki_store.get_entry.assert_awaited_once_with("e1")


async def test_wiki_entry_without_source_chunks_returns_empty_list(service_with_wiki, monkeypatch):
    # 词条缺源切片（旧词条/生成异常）→ 空数组而非炸响——锚定不可用但不影响浏览。
    service_with_wiki.wiki_store.get_entry = AsyncMock(return_value={"id": "e1"})
    _mock_impls(monkeypatch)
    client = _client(service_with_wiki)
    kb = _create_kb(client)

    body = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "Gateway 职责"}).json()

    assert body["paths"]["wiki"]["hits"][0]["source_chunk_ids"] == []


async def test_wiki_store_missing_entry_degrades_to_empty_list(service_with_wiki, monkeypatch):
    service_with_wiki.wiki_store.get_entry = AsyncMock(return_value=None)
    _mock_impls(monkeypatch)
    client = _client(service_with_wiki)
    kb = _create_kb(client)

    body = client.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "Gateway 职责"}).json()

    assert body["paths"]["wiki"]["hits"][0]["source_chunk_ids"] == []


async def test_recall_test_rejects_blank_query(service, monkeypatch):
    _mock_impls(monkeypatch)
    client = _client(service)
    kb = _create_kb(client)
    url = f"/api/knowledge-bases/{kb['id']}/recall-test"
    assert client.post(url, json={"query": ""}).status_code == 422
    assert client.post(url, json={"query": "   "}).status_code == 422


async def test_recall_test_top_k_bounds(service, monkeypatch):
    _mock_impls(monkeypatch)
    client = _client(service)
    kb = _create_kb(client)
    url = f"/api/knowledge-bases/{kb['id']}/recall-test"
    assert client.post(url, json={"query": "x", "top_k": 0}).status_code == 422
    assert client.post(url, json={"query": "x", "top_k": 21}).status_code == 422
    assert client.post(url, json={"query": "x", "top_k": 20}).status_code == 200
    assert client.post(url, json={"query": "x"}).status_code == 200, "top_k 默认 5"


async def test_recall_test_gate_403_404_and_impls_untouched(service, monkeypatch):
    vector, graph, wiki = _mock_impls(monkeypatch)
    owner_client = _client(service, _owner)
    kb = _create_kb(owner_client)
    stranger = _client(service, _stranger)

    assert stranger.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "x"}).status_code == 403
    assert owner_client.post("/api/knowledge-bases/nonexistent/recall-test", json={"query": "x"}).status_code == 404
    for impl in (vector, graph, wiki):
        impl.assert_not_called(), "门禁先于 impl 调用"


async def test_recall_test_graph_rerank_resolves_through_the_factory(service, monkeypatch):
    """图检索腿的重排器必须由 reranker_factory 解析（spec 2026-09-14 P1）。

    recall_test 承诺复用线上 `_*_impl`「verbatim」，而线上 graph_search 传的是
    `build_reranker()`。若这里自己 new 一个百炼重排器，把 rerank 指向非 dashscope
    的部署会在召回测试里静默走回百炼——RerankerError 降级成余弦序，界面上看不出差别。
    """
    _vector, graph, _wiki = _mock_impls(monkeypatch)
    real_config = app_config_module.get_app_config()
    sentinel = object()
    built: list[int] = []
    monkeypatch.setattr(ks_module, "build_reranker", lambda: built.append(1) or sentinel)
    client = _client(service)
    kb = _create_kb(client)
    url = f"/api/knowledge-bases/{kb['id']}/recall-test"

    def _config_with(graph_rerank: bool):
        return real_config.model_copy(update={"rag": real_config.rag.model_copy(update={"graph_rerank": graph_rerank})})

    monkeypatch.setattr(app_config_module, "get_app_config", lambda: _config_with(True))
    assert client.post(url, json={"query": "x"}).status_code == 200
    assert graph.call_args.kwargs["reranker"] is sentinel, "图腿必须拿到工厂解析出的重排器"
    assert len(built) == 1

    # 关闭时不构造——与线上 `build_reranker() if rag.graph_rerank else None` 同形
    built.clear()
    monkeypatch.setattr(app_config_module, "get_app_config", lambda: _config_with(False))
    assert client.post(url, json={"query": "x"}).status_code == 200
    assert graph.call_args.kwargs["reranker"] is None
    assert built == [], "graph_rerank 关闭时不应构造重排器"


# ── integration: real impls against the seeded tools_env ─────────────────


class _StubReranker:
    """Deterministic reranker: earlier candidates get higher scores."""

    async def rerank(self, query: str, texts: list[str], *, top_n: int) -> list[tuple[int, float]]:
        return [(index, 1.0 - index * 0.01) for index in range(min(top_n, len(texts)))]


class _QueryLLM:
    """Query-side entity extractor stub returning fixed entity names."""

    def __init__(self, names: list[str]) -> None:
        self._names = names

    async def ainvoke(self, messages, **_kwargs) -> SimpleNamespace:
        # _extract_query_entities expects {"entities": [...]}, not a bare list
        return SimpleNamespace(content=json.dumps({"entities": self._names}, ensure_ascii=False))


@requires_qdrant
@pytest.mark.integration
async def test_recall_test_matches_direct_impl_results(tools_env, monkeypatch, tmp_path):  # noqa: F811 — fixture param shadows the re-export
    """The API fans out to the real impls: results must match direct impl calls."""
    embedder = tools_env["embedder"]
    monkeypatch.setattr(ks_module, "_hybrid_search_impl", partial(_hybrid_search_impl, embedder=embedder, reranker=_StubReranker()))
    monkeypatch.setattr(ks_module, "_graph_search_impl", partial(_graph_search_impl, embedder=embedder, llm=_QueryLLM(["Gateway"])))
    monkeypatch.setattr(ks_module, "_wiki_search_impl", partial(_wiki_search_impl, embedder=embedder))
    service = KnowledgeService(
        store=tools_env["store"],
        vector_store=tools_env["vector_store"],
        graph_store=tools_env["graph_store"],
        wiki_store=tools_env["wiki_store"],
        worker=None,
        data_dir=tmp_path,
    )

    query = "Gateway 的职责"
    result = await service.recall_test(kb_id=TOOLS_KB_ID, user_id=TOOLS_OWNER_ID, query=query, top_k=3)

    runtime = SimpleNamespace(context={"kb_id": TOOLS_KB_ID, "user_id": TOOLS_OWNER_ID})
    direct_vector = await _hybrid_search_impl(query, runtime, store=tools_env["store"], vector_store=tools_env["vector_store"], embedder=embedder, reranker=_StubReranker(), top_k=3)
    direct_wiki = await _wiki_search_impl(query, runtime, store=tools_env["store"], wiki_store=tools_env["wiki_store"], vector_store=tools_env["vector_store"], embedder=embedder, top_k=3)

    # Set-level comparison: the service hits the REAL DashScope embed/rerank
    # while the direct calls use the deterministic stubs — hit ORDER is the
    # external service's call and fluctuates; identical membership is the
    # "recall-test reuses the impls faithfully" contract.
    assert {hit["chunk_id"] for hit in result["paths"]["vector"]["hits"]} == {row["chunk_id"] for row in direct_vector["results"]}
    assert {hit["entry_id"] for hit in result["paths"]["wiki"]["hits"]} == {entry["entry_id"] for entry in direct_wiki["entries"]}
    assert result["paths"]["graph"]["entities"], f"graph 路应命中种子实体 Gateway: {result['paths']['graph']!r}"
    assert result["paths"]["graph"]["evidence"], "graph 路应带出切片证据"
    # The citation-span note in impl messages is model-facing prompt plumbing;
    # the recall-test UI shows messages to humans, so it must be stripped.
    for path in result["paths"].values():
        assert "引用编号" not in path["message"], f"model-directed note leaked into the UI message: {path['message']!r}"
    assert "检索到" in result["paths"]["vector"]["message"], "the human-facing summary must survive stripping"
    assert all(isinstance(value, int) for value in result["elapsed_ms"].values())
