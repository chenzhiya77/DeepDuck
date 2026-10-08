"""list_knowledge_documents — the document-level read-only tool (spec §2.1).

Enumerates every document of the bound knowledge base straight from the
business store (no Qdrant, no embedding) with an honest per-status count,
so corpus questions ("what is in this library", "which documents exist")
are answered from the tool surface instead of recall luck.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE, can_access, resolve_kb_scope
from deerflow.knowledge.store import KnowledgeStore, get_knowledge_store
from deerflow.tools.types import Runtime

logger = logging.getLogger(__name__)


async def _list_documents_impl(runtime: Any, *, store: KnowledgeStore | None = None) -> dict:
    """Core implementation — testable without the @tool wrapper."""
    kb_id, user_id = resolve_kb_scope(runtime)
    if not kb_id:
        return {"documents": [], "message": NO_KB_GUIDANCE}
    store = store or get_knowledge_store()
    if not await can_access(store, user_id, kb_id):
        return {"documents": [], "message": ACCESS_DENIED_MESSAGE}

    rows = await store.list_documents(kb_id)
    documents = [
        {
            "doc_id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "chunk_count": row["chunk_count"],
        }
        for row in rows
    ]
    if not documents:
        return {"documents": [], "message": "当前知识库中还没有文档。"}

    ready = sum(1 for document in documents if document["status"] == "ready")
    failed = sum(1 for document in documents if document["status"] == "failed")
    in_progress = len(documents) - ready - failed
    counts = [label for count, label in ((ready, f"就绪 {ready}"), (in_progress, f"处理中 {in_progress}"), (failed, f"失败 {failed}")) if count]
    return {"documents": documents, "message": f"共 {len(documents)} 篇文档（{' · '.join(counts)}）。"}


@tool(parse_docstring=True)
async def list_knowledge_documents(runtime: Runtime) -> dict:
    """List every document in the knowledge base bound to this conversation, with an honest status count.

    Use this tool when:
    - The question asks what the knowledge base contains — which documents exist (corpus enumeration)
    - You need a document's doc_id to address the same document in a follow-up read

    Skip this tool when:
    - The question needs factual content from the documents — retrieve with hybrid_search instead

    Returns every document as doc_id/name/status/chunk_count plus a status summary (ready / in progress / failed). Missing knowledge-base binding returns guidance instead of listing.

    Args:
        runtime: Tool runtime carrying the bound ``kb_id`` in its context.
    """
    return await _list_documents_impl(runtime)
