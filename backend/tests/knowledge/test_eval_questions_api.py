"""Contract tests for the eval question bank CRUD endpoints (spec 2026-08-27 §4.2).

GET    ``/api/knowledge-bases/{kb_id}/eval/questions`` — 读全量题库（空文件 → 空表）。
POST   ``/api/knowledge-bases/{kb_id}/eval/questions`` — 新增一题（id 服务端生成，
带 id 字段 422；字段违例 422 detail 含字段名）。
DELETE ``/api/knowledge-bases/{kb_id}/eval/questions/{question_id}`` — 删一题
（204 / 404）。存量题库文件脏 → 读改写均 500 且 detail 指行号（不静默跳过）。

基建对齐 ``test_eval_runs_api.py``：真实 KnowledgeService + session_factory。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.routers import knowledge_bases
from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.store import KnowledgeStore

pytestmark = pytest.mark.asyncio

OWNER_ID = str(UUID(int=1234567890))


def _owner() -> User:
    return User(email="owner@example.com", password_hash="x", system_role="user", id=UUID(OWNER_ID))


@pytest.fixture
def service(session_factory, tmp_path) -> KnowledgeService:
    vector_store = MagicMock()
    vector_store.chunks_collection = "kb_chunks"
    vector_store.entities_collection = "kb_entities"
    vector_store.wiki_entries_collection = "kb_wiki"
    vector_store.manual_cards_collection = "kb_cards"
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=None,
        worker=None,
        data_dir=tmp_path,
    )


def _client(service: KnowledgeService, user_factory=_owner) -> TestClient:
    from _router_auth_helpers import make_authed_test_app

    app = make_authed_test_app(user_factory=user_factory)
    app.state.knowledge_service = service
    app.include_router(knowledge_bases.router)
    return TestClient(app)


def _create_kb(client: TestClient, name: str = "评测题库") -> dict:
    response = client.post("/api/knowledge-bases", json={"name": name, "description": "d"})
    assert response.status_code == 201, response.text
    return response.json()


def _golden_file(service: KnowledgeService, kb_id: str) -> Path:
    return Path(service.data_dir) / "knowledge" / kb_id / "golden.jsonl"


def _valid_body(**overrides) -> dict:
    body = {
        "query": "什么是退休年龄",
        "category": "fact",
        "expected_path": "vector",
        "relevant_chunk_ids": [],
        "relevant_entities": [],
        "reference_answer": None,
    }
    body.update(overrides)
    return {k: v for k, v in body.items() if v is not None or k == "reference_answer"}


# ── GET ──────────────────────────────────────────────────────────────────


async def test_empty_bank_returns_empty_list(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval/questions")

    assert response.status_code == 200, response.text
    assert response.json() == {"questions": [], "total": 0}


async def test_get_returns_full_question_fields(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    created = client.post(
        f"/api/knowledge-bases/{kb['id']}/eval/questions",
        json=_valid_body(
            query="图检索走哪条路",
            category="relation",
            expected_path="graph",
            relevant_chunk_ids=["a" * 32 + "#0001"],
            relevant_entities=["退休"],
            reference_answer="图谱路径。",
        ),
    ).json()

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval/questions").json()
    assert body["total"] == 1
    question = body["questions"][0]
    assert question["id"] == created["id"]
    assert question["query"] == "图检索走哪条路"
    assert question["category"] == "relation"
    assert question["expected_path"] == "graph"
    assert question["relevant_chunk_ids"] == ["a" * 32 + "#0001"]
    assert question["relevant_entities"] == ["退休"]
    assert question["reference_answer"] == "图谱路径。"


async def test_get_dirty_file_maps_to_500_with_line_hint(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    path = _golden_file(service, kb["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    good = '{"id": "q_ok00001", "query": "有效问题", "expected_path": "vector", "relevant_chunk_ids": [], "relevant_entities": [], "category": "fact"}'
    path.write_text(good + '\n{"broken": ', encoding="utf-8")

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval/questions")

    assert response.status_code == 500
    assert "golden.jsonl" in response.json()["detail"]


async def test_unknown_kb_404_on_get(service) -> None:
    client = _client(service)

    assert client.get("/api/knowledge-bases/kb-missing/eval/questions").status_code == 404


# ── POST ─────────────────────────────────────────────────────────────────


async def test_post_creates_question_with_server_generated_id(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/eval/questions", json=_valid_body())

    assert response.status_code == 201, response.text
    question = response.json()
    assert question["id"].startswith("q_")
    # 文件真实落盘且可被守卫加载器回读（一行一题）。
    lines = _golden_file(service, kb["id"]).read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1


async def test_post_with_explicit_id_field_is_422(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(
        f"/api/knowledge-bases/{kb['id']}/eval/questions",
        json=_valid_body(id="hacked"),
    )

    assert response.status_code == 422


async def test_post_schema_violation_422_detail_names_the_field(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(
        f"/api/knowledge-bases/{kb['id']}/eval/questions",
        json=_valid_body(category="vibe"),
    )

    assert response.status_code == 422
    assert "category" in response.json()["detail"]


async def test_post_bad_chunk_id_format_422(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(
        f"/api/knowledge-bases/{kb['id']}/eval/questions",
        json=_valid_body(relevant_chunk_ids=["not-a-chunk-id"]),
    )

    assert response.status_code == 422


async def test_unknown_kb_404_on_post(service) -> None:
    client = _client(service)

    response = client.post("/api/knowledge-bases/kb-missing/eval/questions", json=_valid_body())

    assert response.status_code == 404


# ── DELETE ───────────────────────────────────────────────────────────────


async def test_delete_then_missing_404(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    question = client.post(f"/api/knowledge-bases/{kb['id']}/eval/questions", json=_valid_body()).json()

    first = client.delete(f"/api/knowledge-bases/{kb['id']}/eval/questions/{question['id']}")

    assert first.status_code == 204
    assert client.get(f"/api/knowledge-bases/{kb['id']}/eval/questions").json()["total"] == 0
    again = client.delete(f"/api/knowledge-bases/{kb['id']}/eval/questions/{question['id']}")
    assert again.status_code == 404


async def test_unknown_kb_404_on_delete(service) -> None:
    client = _client(service)

    assert client.delete("/api/knowledge-bases/kb-missing/eval/questions/q_whatever").status_code == 404
