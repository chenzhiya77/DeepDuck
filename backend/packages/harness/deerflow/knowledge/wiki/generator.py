"""Wiki entry generation: triggered batch + dirty incremental (spec §3.5).

- **Head-entity strategy**: only the top ~20% entities (score = graph degree +
  ``source_chunk_ids`` frequency) get an entity-level entry; the long tail is
  served by raw graph fragments.
- **Triggered batch**: the first generation runs once the KB's indexing
  completion crosses a threshold (or the user clicks "生成百科" — the API
  simply calls ``generate_wiki`` directly); afterwards the KB runs in dirty
  incremental mode.
- **Dirty incremental**: a newly indexed doc marks the entries of its touched
  entities ``dirty``; ``generate_wiki(only_dirty=True)`` regenerates exactly
  those against the entity's *current* source chunks and clears the flag.

Each entry is written by the main model (stable long-form Chinese), full text
stored in ``wiki_entries``, dense vector (title + content head) upserted to
``kb_wiki_entries`` with a pointer-only payload.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import func, select

from deerflow.knowledge.embedder import EmbeddingResult
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.models import DocumentRow
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.vector_store import KnowledgeVectorStore, WikiEntryUpsert
from deerflow.knowledge.wiki.store import WikiStore

logger = logging.getLogger(__name__)

#: Share of entities that get their own entry (spec §3.5 头部 ~20%).
DEFAULT_TOP_RATIO = 0.2
#: Fraction of documents that must be ready before auto-triggering (spec §3.7).
DEFAULT_TRIGGER_THRESHOLD = 0.9
#: Characters of entry content folded into the embedding text.
EMBED_CONTENT_CHARS = 500

#: In-flight generation runs per KB (single-process asyncio counter). Feeds the
#: library-level ``wiki: generating`` sub-status on the documents endpoint —
#: covers both the manual button and the worker's auto trigger (spec §5 P3).
_IN_FLIGHT: dict[str, int] = {}


def wiki_generation_in_progress(kb_id: str) -> bool:
    """True while any ``generate_wiki`` run for the KB is active."""
    return _IN_FLIGHT.get(kb_id, 0) > 0


WIKI_SYSTEM_PROMPT = """你是知识库百科撰写者。根据给定的实体信息与来源切片，撰写一篇简明的中文百科条目：
- 第一行输出 markdown 一级标题（# 实体名）。
- 正文 2~4 段：先给定义与定位，再展开关键事实、与其他实体的关系，最后补充应用场景或注意事项（若材料支持）。
- 严格依据给定材料撰写，材料没有的信息不要编造；不要输出参考文献或链接。"""


class _LLM(Protocol):
    async def ainvoke(self, messages: Any) -> Any: ...


class _Embedder(Protocol):
    batch_size: int

    async def embed(self, texts: Sequence[str], *, text_type: str = "document") -> list[EmbeddingResult]: ...


@dataclass(slots=True)
class WikiStats:
    """Outcome of one ``generate_wiki`` run."""

    selected: int = 0
    generated: int = 0
    titles: list[str] = field(default_factory=list)


async def select_head_entities(graph_store: GraphStore, kb_id: str, *, top_ratio: float = DEFAULT_TOP_RATIO) -> list[dict[str, Any]]:
    """Rank entities by degree + frequency and keep the head slice.

    Score = NetworkX degree (in+out) + len(source_chunk_ids). Ties break by
    name for determinism. Always selects at least one entity when the graph
    is non-empty.
    """
    entities = await graph_store.list_entities(kb_id)
    if not entities:
        return []
    graph = await graph_store.load_networkx(kb_id)
    scored = sorted(
        entities,
        key=lambda row: (-(int(graph.degree(row["name"])) if graph.has_node(row["name"]) else 0) - len(row.get("source_chunk_ids") or []), row["name"]),
    )
    head_count = max(1, math.ceil(len(scored) * top_ratio))
    return scored[:head_count]


async def wiki_trigger_ready(store: KnowledgeStore, kb_id: str, *, threshold: float = DEFAULT_TRIGGER_THRESHOLD) -> bool:
    """True when the share of ``ready`` documents meets the threshold.

    A KB with no documents never auto-triggers (spec §3.7 鸡生蛋问题: the
    first batch is triggered manually or by this completion check).
    """
    async with store._sf() as session:
        total = int((await session.execute(select(func.count()).select_from(DocumentRow).where(DocumentRow.kb_id == kb_id))).scalar_one())
        if total == 0:
            return False
        ready = int((await session.execute(select(func.count()).select_from(DocumentRow).where(DocumentRow.kb_id == kb_id, DocumentRow.status == "ready"))).scalar_one())
    return ready / total >= threshold


async def mark_dirty_for_entities(wiki_store: WikiStore, kb_id: str, entity_names: Collection[str]) -> int:
    """New-document hook: flag the entries of the touched entities as dirty."""
    return await wiki_store.mark_dirty_for_titles(kb_id, entity_names)


def _default_llm():
    """Wiki writing uses the main model (first configured) per spec §3.4 分层."""
    from deerflow.models.factory import create_chat_model

    return create_chat_model()


async def generate_wiki(
    store: KnowledgeStore,
    graph_store: GraphStore,
    wiki_store: WikiStore,
    vector_store: KnowledgeVectorStore | None = None,
    *,
    kb_id: str,
    llm: _LLM | None = None,
    embedder: _Embedder | None = None,
    top_ratio: float = DEFAULT_TOP_RATIO,
    only_dirty: bool = False,
) -> WikiStats:
    """Generate (or regenerate) wiki entries for a KB.

    Default mode processes the current head entities (triggered batch);
    ``only_dirty=True`` processes exactly the dirty entries (incremental).
    """
    if llm is None:
        llm = _default_llm()

    _IN_FLIGHT[kb_id] = _IN_FLIGHT.get(kb_id, 0) + 1
    try:
        if only_dirty:
            dirty = await wiki_store.list_entries(kb_id, status="dirty")
            if not dirty:
                return WikiStats()
            entity_rows = {row["name"]: row for row in await graph_store.list_entities(kb_id)}
            targets = [entity_rows[entry["title"]] for entry in dirty if entry["title"] in entity_rows]
            if len(targets) < len(dirty):
                logger.info("wiki regeneration: %d dirty entries have no graph entity left, skipped", len(dirty) - len(targets))
        else:
            targets = await select_head_entities(graph_store, kb_id, top_ratio=top_ratio)

        stats = WikiStats(selected=len(targets))
        if not targets:
            return stats

        for row in targets:
            chunk_ids = list(row.get("source_chunk_ids") or [])
            chunks = await store.get_chunks_by_ids(chunk_ids)
            materials = "\n\n".join(f"【切片 {i + 1}】{chunk['text']}" for i, chunk in enumerate(chunks))
            messages = [
                {"role": "system", "content": WIKI_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (f"实体：{row['name']}\n类型：{row.get('type') or '未分类'}\n已有描述：{row.get('description') or '无'}\n\n来源切片：\n{materials or '（无切片材料）'}"),
                },
            ]
            response = await llm.ainvoke(messages)
            content = str(response.content).strip()
            if not content:
                logger.warning("wiki generation returned empty content for entity %s, skipped", row["name"])
                continue
            entry = await wiki_store.upsert_entry(kb_id, title=row["name"], content=content, source_chunk_ids=chunk_ids, status="ready")
            if vector_store is not None and embedder is not None:
                (embedding,) = await embedder.embed([f"{row['name']}\n{content[:EMBED_CONTENT_CHARS]}"])
                await vector_store.upsert_wiki_entries([WikiEntryUpsert(entry_id=entry["id"], kb_id=kb_id, title=row["name"], dense=embedding.dense)])
            stats.generated += 1
            stats.titles.append(row["name"])
        return stats
    finally:
        remaining = _IN_FLIGHT.get(kb_id, 0) - 1
        if remaining > 0:
            _IN_FLIGHT[kb_id] = remaining
        else:
            _IN_FLIGHT.pop(kb_id, None)
