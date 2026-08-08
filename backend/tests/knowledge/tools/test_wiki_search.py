"""Tests for wiki_search (spec §4.3): vector top-k → full entry from the DB."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE
from deerflow.tools.builtins.wiki_search_tool import _wiki_search_impl

from ..conftest import requires_qdrant
from .conftest import KB_ID, OWNER_ID


def _runtime(**context) -> SimpleNamespace:
    return SimpleNamespace(context=context)


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_wiki_search_returns_full_entry(tools_env):
    result = await _wiki_search_impl(
        "DeerFlow 是什么",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        wiki_store=tools_env["wiki_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
        top_k=2,
    )

    entries = result["entries"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["entry_id"] == tools_env["entry_id"]
    assert entry["title"] == "DeerFlow"
    # Full text comes from the wiki_entries table, not the vector payload.
    assert "超级智能体系统" in entry["content"]
    assert entry["score"] > 0


@requires_qdrant
@pytest.mark.integration
@pytest.mark.asyncio
async def test_wiki_search_empty_collection(tools_env):
    await tools_env["client"].delete_collection(tools_env["vector_store"].wiki_entries_collection)
    await tools_env["vector_store"].init_collections()  # recreate empty

    result = await _wiki_search_impl(
        "DeerFlow",
        _runtime(kb_id=KB_ID, user_id=OWNER_ID),
        store=tools_env["store"],
        wiki_store=tools_env["wiki_store"],
        vector_store=tools_env["vector_store"],
        embedder=tools_env["embedder"],
    )

    assert result["entries"] == []
    assert "未" in result["message"] or "没有" in result["message"]


@pytest.mark.asyncio
async def test_wiki_search_without_kb_returns_guidance(session_factory):
    from deerflow.knowledge.store import KnowledgeStore
    from deerflow.knowledge.wiki.store import WikiStore

    result = await _wiki_search_impl(
        "任意",
        _runtime(user_id=OWNER_ID),
        store=KnowledgeStore(session_factory),
        wiki_store=WikiStore(session_factory),
        vector_store=None,
        embedder=None,
    )
    assert result["entries"] == []
    assert result["message"] == NO_KB_GUIDANCE


@pytest.mark.asyncio
async def test_wiki_search_denies_non_owner(session_factory):
    from deerflow.knowledge.store import KnowledgeStore
    from deerflow.knowledge.wiki.store import WikiStore

    store = KnowledgeStore(session_factory)
    await store.create_kb(kb_id="kb-x", owner_id=OWNER_ID, name="私有")

    result = await _wiki_search_impl(
        "任意",
        _runtime(kb_id="kb-x", user_id="user-2"),
        store=store,
        wiki_store=WikiStore(session_factory),
        vector_store=None,
        embedder=None,
    )
    assert result["entries"] == []
    assert result["message"] == ACCESS_DENIED_MESSAGE
