"""Tests for POST /knowledge-bases/{kb_id}/chunks/{chunk_id}/re-extract endpoint (Phase-3 Batch-1 P3).

Single-chunk re-extraction without full document re-parse. Focuses on the endpoint
contract: 404 for missing chunks, 409 for in-flight documents, 501 until the LLM
extraction wiring lands.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.routers import knowledge_bases
from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.store import KnowledgeStore

pytestmark = pytest.mark.asyncio

OWNER_ID = str(uuid.UUID(int=1234567890))


def _owner() -> User:
    return User(email="owner@example.com", password_hash="x", system_role="user", id=uuid.UUID(OWNER_ID))


@pytest.fixture
def service(session_factory, tmp_path) -> KnowledgeService:
    vector_store = MagicMock()
    vector_store.delete_by_doc = AsyncMock()
    vector_store.delete_entities = AsyncMock()
    graph_store = MagicMock()
    wiki_store = MagicMock()
    worker = MagicMock()
    worker.submit = AsyncMock()

    store = KnowledgeStore(session_factory)
    return KnowledgeService(
        store=store,
        vector_store=vector_store,
        graph_store=graph_store,
        wiki_store=wiki_store,
        worker=worker,
        data_dir=tmp_path,
    )


def _client(service: KnowledgeService, user_factory=_owner) -> TestClient:
    from _router_auth_helpers import make_authed_test_app

    app = make_authed_test_app(user_factory=user_factory)
    app.state.knowledge_service = service
    app.include_router(knowledge_bases.router)
    return TestClient(app)


@pytest.fixture
async def setup_kb_with_chunks(service):
    """Setup KB with document and chunks in ready state."""
    kb_id = f"kb-test-{uuid.uuid4().hex[:8]}"
    doc_id = "doc-re-extract-001"
    chunk_ids = [f"{doc_id}-c0", f"{doc_id}-c1"]

    await service.store.create_kb(kb_id=kb_id, owner_id=OWNER_ID, name="Re-extract Test KB")
    await service.store.create_document(doc_id=doc_id, kb_id=kb_id, uploader_id=OWNER_ID, name="test.txt", size_bytes=100, storage_path="/test.txt")

    for i, chunk_id in enumerate(chunk_ids):
        await service.store.insert_chunks(
            [
                {
                    "chunk_id": chunk_id,
                    "doc_id": doc_id,
                    "kb_id": kb_id,
                    "chunk_index": i,
                    "text": f"Chunk {i} text for extraction.",
                    "token_count": 10,
                    "extract_status": "done",
                    "entities": [],
                }
            ]
        )

    # Document must be ready (terminal) for re-extract to be allowed
    await service.store.update_document_status(doc_id, "ready")
    return kb_id, doc_id, chunk_ids


class TestChunkReExtractEndpoint:
    """RED tests: verify re-extract endpoint contract."""

    async def test_re_extract_returns_404_when_chunk_not_found(self, service):
        """POST re-extract with non-existent chunk should return 404."""
        client = _client(service)
        kb = await service.store.create_kb(kb_id=f"kb-{uuid.uuid4().hex}", owner_id=OWNER_ID, name="dummy")

        response = client.post(f"/api/knowledge-bases/{kb['id']}/chunks/non-existent/re-extract")

        assert response.status_code == 404

    async def test_re_extract_returns_409_when_document_processing(self, setup_kb_with_chunks, service):
        """Re-extract must be rejected while the document pipeline is mid-flight."""
        kb_id, doc_id, chunk_ids = setup_kb_with_chunks
        client = _client(service)

        await service.store.update_document_status(doc_id, "parsing")

        response = client.post(f"/api/knowledge-bases/{kb_id}/chunks/{chunk_ids[0]}/re-extract")

        assert response.status_code == 409
        assert "being processed" in response.json()["detail"]

    async def test_re_extract_rejects_when_document_failed_check_passes(self, setup_kb_with_chunks, service):
        """A failed (terminal) document must NOT trigger the 409 guard."""
        kb_id, doc_id, chunk_ids = setup_kb_with_chunks
        client = _client(service)

        await service.store.update_document_status(doc_id, "failed")

        response = client.post(f"/api/knowledge-bases/{kb_id}/chunks/{chunk_ids[0]}/re-extract")

        # Not 409 — extraction itself is unwired so 501 is the expected next wall
        assert response.status_code == 501

    async def test_re_extract_returns_501_until_llm_wiring_lands(self, setup_kb_with_chunks, service):
        """Ready document + valid chunk → 501 placeholder (extraction needs LLM)."""
        kb_id, doc_id, chunk_ids = setup_kb_with_chunks
        client = _client(service)

        response = client.post(f"/api/knowledge-bases/{kb_id}/chunks/{chunk_ids[0]}/re-extract")

        assert response.status_code == 501
        assert "not implemented" in response.json()["detail"].lower()
