"""graph_search — the graph path (spec §4.2).

Chain: query → local LLM entity/keyword extraction → ``kb_entities`` vector
match → NetworkX 1–2 hop expansion (both directions) → chunk evidence via
``source_chunk_ids`` (precise recall) + the ``entities`` payload back-query on
``kb_chunks`` (elastic recall). Chunk text always comes from the business-DB
``chunks`` table. An empty answer is returned honestly — the navigator never
fabricates graph content.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from langchain.tools import tool

from deerflow.knowledge.access import ACCESS_DENIED_MESSAGE, NO_KB_GUIDANCE, can_access, resolve_kb_scope
from deerflow.knowledge.embedder import DashScopeEmbedder
from deerflow.knowledge.graph.extractor import _strip_fence, get_extract_llm
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.store import KnowledgeStore, get_knowledge_store
from deerflow.knowledge.vector_store import KnowledgeVectorStore, get_vector_store
from deerflow.tools.types import Runtime

logger = logging.getLogger(__name__)

_QUERY_ENTITY_SYSTEM_PROMPT = """从用户问题中抽取需要检索的实体名或关键词（优先使用知识库中可能出现的规范名称），只输出严格 JSON：{"entities": ["...", "..."]}。问题中没有可抽取的实体时输出 {"entities": []}。不要输出任何其他内容。"""

#: Minimum cosine score for a query entity to land on a graph entity — keeps
#: "nothing found" honest instead of returning far-neighbor noise.
ENTITY_MATCH_MIN_SCORE = 0.3


def _empty(message: str) -> dict:
    return {"entities": [], "relations": [], "evidence": [], "message": message}


async def _extract_query_entities(query: str, llm: Any) -> list[str]:
    response = await llm.ainvoke(
        [
            {"role": "system", "content": _QUERY_ENTITY_SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ]
    )
    try:
        data = json.loads(_strip_fence(str(response.content)))
    except json.JSONDecodeError:
        logger.warning("graph_search: query entity extraction returned malformed JSON")
        return []
    if not isinstance(data, dict):
        return []
    return [str(name).strip() for name in (data.get("entities") or []) if str(name).strip()]


async def _graph_search_impl(
    query: str,
    runtime: Any,
    *,
    store: KnowledgeStore | None = None,
    graph_store: GraphStore | None = None,
    vector_store: KnowledgeVectorStore | None = None,
    embedder: Any = None,
    llm: Any = None,
    per_entity_match: int = 3,
    hops: int = 2,
    evidence_limit: int = 8,
) -> dict:
    """Core implementation — testable without the @tool wrapper."""
    kb_id, user_id = resolve_kb_scope(runtime)
    if not kb_id:
        return _empty(NO_KB_GUIDANCE)
    store = store or get_knowledge_store()
    if not await can_access(store, user_id, kb_id):
        return _empty(ACCESS_DENIED_MESSAGE)
    graph_store = graph_store or GraphStore(store._sf)
    vector_store = vector_store or get_vector_store()
    embedder = embedder or DashScopeEmbedder()
    llm = llm or get_extract_llm()

    # 1. Query-side entity/keyword extraction (small model).
    query_names = await _extract_query_entities(query, llm)
    if not query_names:
        return _empty("未能从问题中识别出可检索的实体；该问题可能更适合向量检索（hybrid_search）。")

    # 2. Land on graph entities via kb_entities vector match.
    matched_names: list[str] = []
    for name in query_names:
        (query_vector,) = await embedder.embed([name], text_type="query")
        for point in await vector_store.query_entities(dense=query_vector.dense, kb_id=kb_id, top_k=per_entity_match, score_threshold=ENTITY_MATCH_MIN_SCORE):
            matched_names.append(str(point.payload["name"]))
    matched_names = list(dict.fromkeys(matched_names))
    if not matched_names:
        return _empty(f"知识图谱中未找到与「{'、'.join(query_names)}」相关的实体。")

    # 3. 1–2 hop expansion over the in-memory graph (both directions).
    graph = await graph_store.load_networkx(kb_id)
    seen: set[str] = {name for name in matched_names if graph.has_node(name)}
    frontier = set(seen)
    for _ in range(max(0, hops)):
        nxt: set[str] = set()
        for node in frontier:
            nxt |= set(graph.successors(node)) | set(graph.predecessors(node))
        nxt -= seen
        seen |= nxt
        frontier = nxt
    if not seen:
        return _empty(f"知识图谱中未找到与「{'、'.join(query_names)}」相关的实体。")

    relations = []
    chunk_ids: list[str] = []
    for source, target, data in graph.edges(data=True):
        if source in seen and target in seen:
            relations.append({"source": source, "target": target, "relation": data.get("relation", ""), "description": data.get("description", "")})
            chunk_ids.extend(data.get("source_chunk_ids") or [])
    entities = []
    for node in sorted(seen):
        data = graph.nodes[node]
        entities.append({"name": node, "type": data.get("type") or "", "description": data.get("description") or ""})
        chunk_ids.extend(data.get("source_chunk_ids") or [])

    # 4. Elastic back-query: chunks whose payload entities contain the names.
    backfill_points = await vector_store.scroll_chunks_by_entities(kb_id=kb_id, entity_names=sorted(seen), limit=20)
    chunk_ids.extend(str(point.payload["chunk_id"]) for point in backfill_points if point.payload.get("chunk_id"))
    chunk_ids = list(dict.fromkeys(chunk_ids))

    # 5. Evidence: chunk text from the business DB, doc names joined once each.
    rows = await store.get_chunks_by_ids(chunk_ids)
    doc_names: dict[str, str] = {}
    evidence = []
    for row in rows[:evidence_limit]:
        doc_id = row["doc_id"]
        if doc_id not in doc_names:
            document = await store.get_document(doc_id)
            doc_names[doc_id] = document["name"] if document else ""
        evidence.append(
            {
                "chunk_id": row["chunk_id"],
                "text": row["text"],
                "doc_name": doc_names[doc_id],
                "heading_path": row.get("heading_path") or [],
                "page": row.get("page"),
            }
        )

    return {
        "entities": entities,
        "relations": relations,
        "evidence": evidence,
        "message": f"命中 {len(matched_names)} 个实体，扩展出 {len(seen)} 个节点、{len(relations)} 条关系、{len(evidence)} 条切片证据。",
    }


@tool(parse_docstring=True)
async def graph_search(
    runtime: Runtime,
    query: Annotated[str, "The relationship/structure question, phrased in the user's language."],
    hops: Annotated[int, "Graph expansion depth from the matched entities (1 or 2, default 2)."] = 2,
) -> dict:
    """Search the knowledge graph of the bound knowledge base (entity relations + chunk evidence).

    Use this tool when:
    - The question is about relationships, dependencies, or multi-hop structure between concepts (e.g. "A 和 B 有什么关系")
    - You need to navigate from known entities to their neighborhood before fetching evidence

    Skip this tool when:
    - The question needs factual detail on a single topic — start with hybrid_search
    - The question asks for a conceptual overview of a head entity — use wiki_search

    The graph is a navigator: it returns entity/relation descriptions plus the linked chunk evidence. An empty result means the graph lacks those entities — answer honestly or fall back to hybrid_search; never fabricate relations.

    Args:
        runtime: Tool runtime carrying the bound ``kb_id`` in its context.
        query: The relationship/structure question, phrased in the user's language.
        hops: Graph expansion depth from the matched entities (1 or 2, default 2).
    """
    return await _graph_search_impl(query, runtime, hops=hops)
