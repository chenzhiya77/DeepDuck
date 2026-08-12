"""Contract tests for the knowledge-base management API (spec §5.3, Phase-1 subset).

Router is thin: every endpoint resolves the caller from the stamped auth
context, enforces the Phase-1 owner-only gate (``can_access`` → 403), and
delegates to ``KnowledgeService`` (upload persistence, cascade deletes,
retry, wiki trigger). The index worker is a mock — its own state machine is
covered in test_worker.py.
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from _router_auth_helpers import make_authed_test_app
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.routers import knowledge_bases
from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.store import KnowledgeStore

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
    worker = MagicMock()
    worker.submit = AsyncMock()
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=None,
        worker=worker,
        data_dir=tmp_path,
    )


def _client(service: KnowledgeService, user_factory=_owner) -> TestClient:
    app = make_authed_test_app(user_factory=user_factory)
    app.state.knowledge_service = service
    app.include_router(knowledge_bases.router)
    return TestClient(app)


def _create_kb(client: TestClient, name: str = "产品资料") -> dict:
    response = client.post("/api/knowledge-bases", json={"name": name, "description": "d"})
    assert response.status_code == 201, response.text
    return response.json()


async def test_kb_crud_round_trip(service):
    client = _client(service)

    kb = _create_kb(client)
    assert kb["owner_id"] == OWNER_ID
    assert kb["visibility"] == "private"

    listing = client.get("/api/knowledge-bases")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [kb["id"]]

    detail = client.get(f"/api/knowledge-bases/{kb['id']}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "产品资料"

    renamed = client.patch(f"/api/knowledge-bases/{kb['id']}", json={"name": "新名字"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "新名字"

    assert client.delete(f"/api/knowledge-bases/{kb['id']}").status_code == 204
    assert client.get(f"/api/knowledge-bases/{kb['id']}").status_code == 404


async def test_kb_validation_rejects_blank_name(service):
    client = _client(service)
    assert client.post("/api/knowledge-bases", json={"name": "  "}).status_code == 422


async def test_non_owner_gets_403_on_every_kb_scoped_route(service):
    owner_client = _client(service, _owner)
    kb = _create_kb(owner_client)
    stranger = _client(service, _stranger)

    assert stranger.get(f"/api/knowledge-bases/{kb['id']}").status_code == 403
    assert stranger.patch(f"/api/knowledge-bases/{kb['id']}", json={"name": "x"}).status_code == 403
    assert stranger.delete(f"/api/knowledge-bases/{kb['id']}").status_code == 403
    assert stranger.get(f"/api/knowledge-bases/{kb['id']}/documents").status_code == 403
    assert stranger.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# t", "text/markdown")}).status_code == 403
    assert stranger.post(f"/api/knowledge-bases/{kb['id']}/wiki/generate").status_code == 403
    assert stranger.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries").status_code == 403
    assert stranger.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries/whatever").status_code == 403
    assert stranger.post(f"/api/knowledge-bases/{kb['id']}/recall-test", json={"query": "x"}).status_code == 403
    # the stranger's own listing stays empty (no cross-owner leakage)
    assert stranger.get("/api/knowledge-bases").json() == []


async def test_upload_document_returns_202_with_uploaded_row_and_enqueues(service, tmp_path):
    client = _client(service)
    kb = _create_kb(client)
    payload = "# 标题\n\n正文内容".encode()

    response = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("手册.md", payload, "text/markdown")})

    assert response.status_code == 202, response.text
    doc = response.json()
    assert doc["status"] == "uploaded"
    assert doc["progress_percent"] == 0
    assert doc["uploader_id"] == OWNER_ID
    assert doc["name"] == "手册.md"
    assert doc["size_bytes"] == len(payload)
    service.worker.submit.assert_awaited_once_with(doc["id"])
    stored = Path(doc["storage_path"])
    assert stored.read_bytes() == payload
    assert str(tmp_path) in str(stored)


async def test_document_list_carries_indexing_fields(service):
    client = _client(service)
    kb = _create_kb(client)
    client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")})

    listing = client.get(f"/api/knowledge-bases/{kb['id']}/documents")

    assert listing.status_code == 200
    (doc,) = listing.json()
    assert doc["status"] == "uploaded"
    assert doc["progress_percent"] == 0
    assert doc["chunk_count"] is None
    assert doc["uploader_id"] == OWNER_ID


async def test_document_list_injects_library_level_wiki_status(service):
    """spec 2026-08-11 §5：列表响应携带 path_status；wiki 子状态为库级镜像，
    响应组装时注入、全库文档共享；dirty 条目计入已生成（2026-08-12 口径）；
    库存为 null 的老行不注入（前端不展示悬停）。"""
    client = _client(service)
    kb = _create_kb(client)
    upload = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")})
    doc_id = upload.json()["id"]
    # 模拟 worker 推进后的 per-path 子状态
    await service.store.update_document_status(doc_id, "indexing", path_status={"vector": "done", "graph": "indexing"})
    # 老行：path_status 为 null
    await service.store.create_document(doc_id="doc-legacy", kb_id=kb["id"], uploader_id=OWNER_ID, name="old.md", size_bytes=1, storage_path="p")

    listing = client.get(f"/api/knowledge-bases/{kb['id']}/documents")
    by_id = {doc["id"]: doc for doc in listing.json()}
    # 库无 ready 条目且未在生成 → pending；同一库级值注入到所有文档
    assert by_id[doc_id]["path_status"] == {"vector": "done", "graph": "indexing", "wiki": "pending"}
    assert by_id["doc-legacy"]["path_status"] is None

    # dirty = 已生成待刷新，内容过期但可用，仍属已生成态
    await service.wiki_store.upsert_entry(kb["id"], title="DeerFlow", content="旧内容", source_chunk_ids=["c1"], status="dirty")
    listing = client.get(f"/api/knowledge-bases/{kb['id']}/documents")
    by_id = {doc["id"]: doc for doc in listing.json()}
    assert by_id[doc_id]["path_status"]["wiki"] == "ready"
    assert by_id["doc-legacy"]["path_status"] is None


async def test_document_list_wiki_generating_only_when_in_flight(service, monkeypatch):
    """generating：库无已生成条目且存在进行中的生成（手动或自动触发）。"""
    client = _client(service)
    kb = _create_kb(client)
    upload = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")})
    doc_id = upload.json()["id"]
    await service.store.update_document_status(doc_id, "indexing", path_status={"vector": "done", "graph": "done"})

    monkeypatch.setattr("app.gateway.services.knowledge_service.wiki_generation_in_progress", lambda _kb_id: True)
    listing = client.get(f"/api/knowledge-bases/{kb['id']}/documents")
    (doc,) = listing.json()
    assert doc["path_status"]["wiki"] == "generating"


async def test_chunks_endpoint_paginates(service, session_factory):
    client = _client(service)
    kb = _create_kb(client)
    upload = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")})
    doc_id = upload.json()["id"]
    store = KnowledgeStore(session_factory)
    await store.insert_chunks([{"chunk_id": f"{doc_id}#{i:04d}", "doc_id": doc_id, "kb_id": kb["id"], "chunk_index": i, "text": f"切片{i}", "heading_path": ["h"], "page": i, "token_count": 10} for i in range(3)])

    page1 = client.get(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}/chunks", params={"offset": 0, "limit": 2})
    page2 = client.get(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}/chunks", params={"offset": 2, "limit": 2})

    assert page1.status_code == 200
    body1 = page1.json()
    assert body1["total"] == 3
    assert [c["chunk_index"] for c in body1["items"]] == [0, 1]
    assert body1["items"][0]["text"] == "切片0"
    assert body1["items"][0]["heading_path"] == ["h"]
    assert [c["chunk_index"] for c in page2.json()["items"]] == [2]


async def test_delete_document_cascades_vectors_graph_wiki_and_rows(service, session_factory):
    client = _client(service)
    kb = _create_kb(client)
    doc_id = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")}).json()["id"]

    assert client.delete(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}").status_code == 204

    service.vector_store.delete_by_doc.assert_awaited_once_with(doc_id)
    assert client.get(f"/api/knowledge-bases/{kb['id']}/documents").json() == []
    # deleting again is a 404, not an error
    assert client.delete(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}").status_code == 404


async def test_delete_kb_cascades_vector_collections(service):
    client = _client(service)
    kb = _create_kb(client)

    assert client.delete(f"/api/knowledge-bases/{kb['id']}").status_code == 204

    service.vector_store.delete_by_kb.assert_awaited_once_with(kb["id"])


async def test_retry_failed_document_wipes_and_reenqueues(service, session_factory):
    client = _client(service)
    kb = _create_kb(client)
    doc_id = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")}).json()["id"]
    store = KnowledgeStore(session_factory)
    await store.update_document_status(doc_id, "failed", error="boom", chunk_count=2, progress_percent=40)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}/retry")

    assert response.status_code == 202, response.text
    doc = response.json()
    assert doc["status"] == "uploaded"
    assert doc["progress_percent"] == 0
    assert doc["error"] is None
    assert doc["chunk_count"] is None
    # one submit for upload + one for retry
    assert service.worker.submit.await_count == 2


async def test_retry_non_failed_document_conflicts(service):
    client = _client(service)
    kb = _create_kb(client)
    doc_id = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files={"file": ("a.md", b"# a", "text/markdown")}).json()["id"]

    assert client.post(f"/api/knowledge-bases/{kb['id']}/documents/{doc_id}/retry").status_code == 409


async def test_wiki_generate_enqueues_background_task(service):
    generate = MagicMock(return_value=None)
    service.wiki_generate_fn = generate
    client = _client(service)
    kb = _create_kb(client)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/wiki/generate")

    assert response.status_code == 202
    assert response.json()["status"] == "enqueued"
    generate.assert_called_once_with(kb["id"])


async def test_manual_wiki_trigger_passes_embedder(service, monkeypatch):
    """Regression: the manual trigger must pass an embedder to generate_wiki.

    generate_wiki silently skips the vector upsert when embedder is None, so a
    service that forgets it produces entries wiki_search can never find — the
    live smoke caught exactly that (entries existed, kb_wiki_entries stayed
    empty).
    """
    captured: dict = {}

    async def _fake_generate(*args, **kwargs):
        captured.update(kwargs)
        return MagicMock(generated=0, titles=[])

    monkeypatch.setattr("app.gateway.services.knowledge_service.generate_wiki", _fake_generate)

    service.trigger_wiki_generation("kb-1")
    await asyncio.gather(*list(service._wiki_tasks))

    assert captured.get("kb_id") == "kb-1"
    assert captured.get("embedder") is not None, "manual wiki trigger must pass an embedder or entries get no vectors"


async def test_wiki_entries_list_and_detail(service):
    """Wiki tab contract (phase-2 batch-1): list is summary-only (no full
    content), detail carries the full entry; both scoped to the kb."""
    client = _client(service)
    kb = _create_kb(client)
    long_content = " DeerFlow 是一个超级代理系统。" * 20
    await service.wiki_store.upsert_entry(kb["id"], title="DeerFlow", content=long_content, source_chunk_ids=["d#0000"])
    await service.wiki_store.upsert_entry(kb["id"], title="Gateway", content="网关简介", source_chunk_ids=["d#0001"], status="dirty")

    listing = client.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries")
    assert listing.status_code == 200
    items = {item["title"]: item for item in listing.json()}
    assert set(items) == {"DeerFlow", "Gateway"}
    deerflow = items["DeerFlow"]
    assert set(deerflow) == {"id", "title", "summary", "status", "updated_at"}
    assert deerflow["summary"] == long_content[:120]
    assert len(deerflow["summary"]) == 120
    assert items["Gateway"]["status"] == "dirty"
    assert items["Gateway"]["summary"] == "网关简介"

    detail = client.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries/{deerflow['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["title"] == "DeerFlow"
    assert body["content"] == long_content
    assert body["source_chunk_ids"] == ["d#0000"]


async def test_wiki_entry_detail_404_on_missing_or_cross_kb(service):
    client = _client(service)
    kb = _create_kb(client)
    other_kb = _create_kb(client, name="另一个库")
    entry = await service.wiki_store.upsert_entry(other_kb["id"], title="Secret", content="x", source_chunk_ids=[])

    assert client.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries/missing").status_code == 404
    # an entry that exists but belongs to another kb must not leak
    assert client.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries/{entry['id']}").status_code == 404
    assert client.get(f"/api/knowledge-bases/{kb['id']}/wiki/entries").json() == []
