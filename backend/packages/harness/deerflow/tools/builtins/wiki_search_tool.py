"""wiki_search — the wiki path (spec §4.3).

query → embedding → ``kb_wiki_entries`` dense top-k → full entry fetched from
the business-DB ``wiki_entries`` table by ``entry_id``. Zero online generation
cost: entries are pre-written offline (Task 6), a hit returns the whole entry.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from langchain.tools import tool

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE, can_access, resolve_kb_scope
from deerflow.knowledge.embedder import DashScopeEmbedder
from deerflow.knowledge.store import KnowledgeStore, get_knowledge_store
from deerflow.knowledge.vector_store import KnowledgeVectorStore, get_vector_store
from deerflow.knowledge.wiki.store import WikiStore
from deerflow.tools.types import Runtime

logger = logging.getLogger(__name__)


async def _wiki_search_impl(
    query: str,
    runtime: Any,
    *,
    store: KnowledgeStore | None = None,
    wiki_store: WikiStore | None = None,
    vector_store: KnowledgeVectorStore | None = None,
    embedder: Any = None,
    top_k: int = 3,
) -> dict:
    """Core implementation — testable without the @tool wrapper."""
    kb_id, user_id = resolve_kb_scope(runtime)
    if not kb_id:
        return {"entries": [], "message": NO_KB_GUIDANCE}
    store = store or get_knowledge_store()
    if not await can_access(store, user_id, kb_id):
        return {"entries": [], "message": ACCESS_DENIED_MESSAGE}
    wiki_store = wiki_store or WikiStore(store._sf)
    vector_store = vector_store or get_vector_store()
    embedder = embedder or DashScopeEmbedder()

    (query_vector,) = await embedder.embed([query], text_type="query")
    points = await vector_store.query_wiki_entries(dense=query_vector.dense, kb_id=kb_id, top_k=top_k)
    entries = []
    for point in points:
        entry = await wiki_store.get_entry(point.payload["entry_id"])
        if entry is None:
            continue
        entries.append(
            {
                "entry_id": entry["id"],
                "title": entry["title"],
                "content": entry["content"],
                "score": point.score,
                "updated_at": entry.get("updated_at"),
            }
        )
    if not entries:
        return {"entries": [], "message": "百科条目库中未找到相关内容（该知识库可能尚未生成百科条目）。"}
    return {"entries": entries, "message": f"命中 {len(entries)} 篇百科条目。"}


@tool(parse_docstring=True)
async def wiki_search(
    runtime: Runtime,
    query: Annotated[str, "The concept/topic question, phrased in the user's language."],
    top_k: Annotated[int, "Number of wiki entries to return (default 3)."] = 3,
) -> dict:
    """Search the generated wiki entries (LLM-written encyclopedia pages) of the bound knowledge base.

    Use this tool when:
    - The question asks for a conceptual overview, definition, or deep dive on an important entity/topic
    - You want a digested long-form answer rather than raw evidence chunks

    Skip this tool when:
    - The question needs precise wording or citation-grade facts — use hybrid_search
    - The question is about relationships between entities — use graph_search

    Entries cover only the head entities (~top 20%); a miss here does not mean the knowledge base lacks the topic — fall back to hybrid_search.

    Args:
        runtime: Tool runtime carrying the bound ``kb_id`` in its context.
        query: The concept/topic question, phrased in the user's language.
        top_k: Number of wiki entries to return (default 3).
    """
    return await _wiki_search_impl(query, runtime, top_k=top_k)
