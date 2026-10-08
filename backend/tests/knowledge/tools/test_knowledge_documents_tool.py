"""list_knowledge_documents (spec §2.1): the corpus-enumeration read-only tool.

Reads the bound library's documents straight from the business store — no
Qdrant, no embedding — and answers with an honest status count. Fail-closed
on missing binding / foreign owner, exactly like the retrieval tools.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE
from deerflow.knowledge.store import KnowledgeStore
from deerflow.tools.builtins.knowledge_documents_tool import _list_documents_impl


def _runtime(**context) -> SimpleNamespace:
    return SimpleNamespace(context=context)


async def _seed_kb(store: KnowledgeStore, *, kb_id: str = "kb-l", owner_id: str = "user-1") -> None:
    await store.create_kb(kb_id=kb_id, owner_id=owner_id, name="清单测试库")


async def _add_document(store: KnowledgeStore, doc_id: str, name: str, *, kb_id: str = "kb-l") -> None:
    await store.create_document(doc_id=doc_id, kb_id=kb_id, uploader_id="user-1", name=name, size_bytes=10, storage_path=f"/{doc_id}")


@pytest.mark.asyncio
async def test_lists_every_document_with_honest_counts(session_factory) -> None:
    store = KnowledgeStore(session_factory)
    await _seed_kb(store)
    await _add_document(store, "d-1", "架构.md")
    await store.update_document_status("d-1", "ready", chunk_count=3)
    await _add_document(store, "d-2", "手册.pdf")
    await store.update_document_status("d-2", "indexing", progress_percent=40)
    await _add_document(store, "d-3", "坏件.pdf")
    await store.update_document_status("d-3", "failed", error="parse boom")

    result = await _list_documents_impl(_runtime(kb_id="kb-l", user_id="user-1"), store=store)

    assert result["message"] == "共 3 篇文档（就绪 1 · 处理中 1 · 失败 1）。"
    by_id = {document["doc_id"]: document for document in result["documents"]}
    assert len(result["documents"]) == 3
    assert by_id["d-1"] == {"doc_id": "d-1", "name": "架构.md", "status": "ready", "chunk_count": 3}
    assert by_id["d-2"]["status"] == "indexing"
    assert by_id["d-2"]["chunk_count"] is None
    assert by_id["d-3"]["status"] == "failed"


@pytest.mark.asyncio
async def test_message_omits_zero_count_groups(session_factory) -> None:
    store = KnowledgeStore(session_factory)
    await _seed_kb(store)
    await _add_document(store, "d-1", "一.md")
    await store.update_document_status("d-1", "ready", chunk_count=1)
    await _add_document(store, "d-2", "二.md")
    await store.update_document_status("d-2", "ready", chunk_count=2)

    result = await _list_documents_impl(_runtime(kb_id="kb-l", user_id="user-1"), store=store)

    assert result["message"] == "共 2 篇文档（就绪 2）。"


@pytest.mark.asyncio
async def test_empty_library_says_so(session_factory) -> None:
    store = KnowledgeStore(session_factory)
    await _seed_kb(store)

    result = await _list_documents_impl(_runtime(kb_id="kb-l", user_id="user-1"), store=store)

    assert result == {"documents": [], "message": "当前知识库中还没有文档。"}


@pytest.mark.asyncio
async def test_unbound_runtime_returns_guidance(session_factory) -> None:
    store = KnowledgeStore(session_factory)

    result = await _list_documents_impl(_runtime(user_id="user-1"), store=store)

    assert result == {"documents": [], "message": NO_KB_GUIDANCE}


@pytest.mark.asyncio
async def test_non_owner_is_denied(session_factory) -> None:
    store = KnowledgeStore(session_factory)
    await _seed_kb(store)
    await _add_document(store, "d-1", "架构.md")

    result = await _list_documents_impl(_runtime(kb_id="kb-l", user_id="user-2"), store=store)

    assert result == {"documents": [], "message": ACCESS_DENIED_MESSAGE}
