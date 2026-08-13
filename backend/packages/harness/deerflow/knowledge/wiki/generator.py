"""Wiki entry generation: triggered batch + dirty incremental (spec §3.5).

- **Eligibility (2026-08-12 revision, ratio head retired)**: an entity earns
  an entry when it passes the hygiene gate (``is_low_quality_entity_name``)
  AND spans at least two chunks — single-chunk entities are served by the
  vector path directly. No total cap; score (degree + frequency) only orders
  generation.
- **Material-bundle batching**: entities whose source-chunk sets overlap
  (Jaccard ≥ 0.5, ≤7 per bundle) share one LLM call returning a JSON array of
  entries; bundles with missing titles or unparseable output fall back to
  per-entity generation.
- **Triggered batch**: the first generation runs once the KB's indexing
  completion crosses a threshold (or the user clicks "生成百科" — the API
  simply calls ``generate_wiki`` directly); afterwards the KB runs in dirty
  incremental mode.
- **Dirty incremental**: a newly indexed doc marks the entries of its touched
  entities ``dirty``; ``generate_wiki(only_dirty=True)`` regenerates those
  per-entity against their *current* source chunks and clears the flag, and
  also backfills eligible entities that have no entry yet (≤40 new per run).

Each entry is written by the main model (stable long-form Chinese), full text
stored in ``wiki_entries``, dense vector (title + content head) upserted to
``kb_wiki_entries`` with a pointer-only payload.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import func, select

from deerflow.knowledge.embedder import EmbeddingResult
from deerflow.knowledge.graph.normalizer import is_low_quality_entity_name
from deerflow.knowledge.graph.store import GraphStore
from deerflow.knowledge.models import DocumentRow
from deerflow.knowledge.store import KnowledgeStore
from deerflow.knowledge.vector_store import KnowledgeVectorStore, WikiEntryUpsert
from deerflow.knowledge.wiki.store import WikiStore

logger = logging.getLogger(__name__)

#: Max new entries written per incremental run (spec §3.5 2026-08-12 pacing).
DEFAULT_BACKFILL_LIMIT = 40
#: Entities per material-bundle LLM call (spec §3.5 2026-08-12 batching).
BATCH_BUNDLE_SIZE = 7
#: Min Jaccard overlap between an entity's chunks and a bundle's union.
BATCH_JACCARD_THRESHOLD = 0.5
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

WIKI_BATCH_SYSTEM_PROMPT = """你是知识库百科撰写者。根据给定的来源切片，为实体清单中的每个实体各撰写一篇简明的中文百科条目：
- 只输出一个 JSON 数组，每个元素形如 {"title": "实体名", "content": "正文"}；title 必须逐字取自实体清单。
- 每篇 content 以 markdown 一级标题（# 实体名）开头，正文 2~4 段：先给定义与定位，再展开关键事实、与其他实体的关系，最后补充应用场景或注意事项（若材料支持）。
- 严格依据给定材料撰写，材料没有的信息不要编造；不要输出参考文献或链接；不要输出 JSON 数组以外的任何内容。"""


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


async def select_eligible_entities(graph_store: GraphStore, kb_id: str) -> list[dict[str, Any]]:
    """Entities that earn a wiki entry, ordered by generation priority.

    Eligibility (spec §3.5 2026-08-12 revision): pass the hygiene gate
    (``is_low_quality_entity_name``) AND span at least two chunks — an entity
    living in a single chunk is served by the vector path directly, so an
    entry would only restate that one section. No total cap; the score
    (NetworkX degree in+out + ``len(source_chunk_ids)``) merely orders the
    output, ties broken by name for determinism.
    """
    entities = await graph_store.list_entities(kb_id)
    candidates = [row for row in entities if not is_low_quality_entity_name(row["name"]) and len(row.get("source_chunk_ids") or []) >= 2]
    if not candidates:
        return []
    graph = await graph_store.load_networkx(kb_id)
    return sorted(
        candidates,
        key=lambda row: (-(int(graph.degree(row["name"])) if graph.has_node(row["name"]) else 0) - len(row.get("source_chunk_ids") or []), row["name"]),
    )


def plan_entry_batches(rows: Sequence[dict[str, Any]], *, batch_size: int = BATCH_BUNDLE_SIZE, jaccard_threshold: float = BATCH_JACCARD_THRESHOLD) -> list[list[dict[str, Any]]]:
    """Pack entities into material bundles sharing one LLM call (spec §3.5).

    Greedy, in the caller's (score) order: an entity joins the first bundle
    whose chunk union overlaps its own chunks at Jaccard ≥ ``jaccard_threshold``
    and still has room (≤ ``batch_size``); otherwise it opens a new bundle.
    Deterministic — same input yields the same bundles.
    """
    batches: list[list[dict[str, Any]]] = []
    unions: list[set[str]] = []
    for row in rows:
        chunks = set(row.get("source_chunk_ids") or [])
        placed = False
        for batch, union in zip(batches, unions, strict=True):
            if len(batch) >= batch_size:
                continue
            shared = chunks & union
            if shared and len(shared) / len(chunks | union) >= jaccard_threshold:
                batch.append(row)
                union |= chunks
                placed = True
                break
        if not placed:
            batches.append([row])
            unions.append(set(chunks))
    return batches


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


def _parse_batch_response(text: str, expected_titles: set[str]) -> dict[str, str]:
    """Parse a bundle response into ``{title: content}``; unparseable payloads
    and titles outside the requested roster are dropped (caller falls back)."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        payload = json.loads(stripped)
    except Exception:
        return {}
    if not isinstance(payload, list):
        return {}
    entries: dict[str, str] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        content = str(item.get("content") or "").strip()
        if title in expected_titles and content:
            entries[title] = content
    return entries


async def _persist_entry(
    wiki_store: WikiStore,
    vector_store: KnowledgeVectorStore | None,
    *,
    kb_id: str,
    row: dict[str, Any],
    content: str,
    embedder: _Embedder | None,
    stats: WikiStats,
) -> None:
    """Store one entry: business row + dense vector, and account for it."""
    entry = await wiki_store.upsert_entry(kb_id, title=row["name"], content=content, source_chunk_ids=list(row.get("source_chunk_ids") or []), status="ready")
    if vector_store is not None and embedder is not None:
        (embedding,) = await embedder.embed([f"{row['name']}\n{content[:EMBED_CONTENT_CHARS]}"])
        await vector_store.upsert_wiki_entries([WikiEntryUpsert(entry_id=entry["id"], kb_id=kb_id, title=row["name"], dense=embedding.dense)])
    stats.generated += 1
    stats.titles.append(row["name"])


async def _write_entry(
    store: KnowledgeStore,
    wiki_store: WikiStore,
    vector_store: KnowledgeVectorStore | None,
    *,
    kb_id: str,
    row: dict[str, Any],
    llm: _LLM,
    embedder: _Embedder | None,
    stats: WikiStats,
) -> None:
    """Per-entity generation: the dirty refresh and bundle-fallback path."""
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
        return
    await _persist_entry(wiki_store, vector_store, kb_id=kb_id, row=row, content=content, embedder=embedder, stats=stats)


async def _write_bundle(
    store: KnowledgeStore,
    wiki_store: WikiStore,
    vector_store: KnowledgeVectorStore | None,
    *,
    kb_id: str,
    rows: list[dict[str, Any]],
    llm: _LLM,
    embedder: _Embedder | None,
    stats: WikiStats,
) -> None:
    """One LLM call per material bundle; misses fall back to ``_write_entry``."""
    chunk_ids = sorted({cid for row in rows for cid in (row.get("source_chunk_ids") or [])})
    chunks = await store.get_chunks_by_ids(chunk_ids)
    materials = "\n\n".join(f"【切片 {i + 1}】{chunk['text']}" for i, chunk in enumerate(chunks))
    roster = "、".join(row["name"] for row in rows)
    messages = [
        {"role": "system", "content": WIKI_BATCH_SYSTEM_PROMPT},
        {"role": "user", "content": f"实体清单：{roster}\n\n来源切片：\n{materials or '（无切片材料）'}"},
    ]
    response = await llm.ainvoke(messages)
    written = _parse_batch_response(str(response.content), {row["name"] for row in rows})
    for row in rows:
        content = written.get(row["name"])
        if content is None:
            logger.warning("wiki bundle missed entity %s; falling back to single generation", row["name"])
            await _write_entry(store, wiki_store, vector_store, kb_id=kb_id, row=row, llm=llm, embedder=embedder, stats=stats)
        else:
            await _persist_entry(wiki_store, vector_store, kb_id=kb_id, row=row, content=content, embedder=embedder, stats=stats)


async def generate_wiki(
    store: KnowledgeStore,
    graph_store: GraphStore,
    wiki_store: WikiStore,
    vector_store: KnowledgeVectorStore | None = None,
    *,
    kb_id: str,
    llm: _LLM | None = None,
    embedder: _Embedder | None = None,
    only_dirty: bool = False,
    backfill_limit: int = DEFAULT_BACKFILL_LIMIT,
) -> WikiStats:
    """Generate (or regenerate) wiki entries for a KB.

    Default mode processes every eligible entity (triggered batch).
    ``only_dirty=True`` regenerates dirty entries per-entity and backfills
    eligible entities lacking an entry — at most ``backfill_limit`` new
    entries per run; the queued remainder is picked up by later triggers
    (spec §3.5 2026-08-12 revision).
    """
    if llm is None:
        llm = _default_llm()

    _IN_FLIGHT[kb_id] = _IN_FLIGHT.get(kb_id, 0) + 1
    try:
        if only_dirty:
            dirty = await wiki_store.list_entries(kb_id, status="dirty")
            entity_rows = {row["name"]: row for row in await graph_store.list_entities(kb_id)}
            singles = [entity_rows[entry["title"]] for entry in dirty if entry["title"] in entity_rows]
            if len(singles) < len(dirty):
                logger.info("wiki regeneration: %d dirty entries have no graph entity left, skipped", len(dirty) - len(singles))
            # 2026-08-12 revision (spec §3.5): backfill = eligible entities
            # without an entry (any status counts — idempotent), paced per run.
            # Disqualified/vanished entities' entries are deleted by the
            # Task 12 lifecycle cascade (delete/merge events) — generate_wiki
            # itself only writes, never deletes.
            entry_titles = {entry["title"] for entry in await wiki_store.list_entries(kb_id)}
            backfill = [row for row in await select_eligible_entities(graph_store, kb_id) if row["name"] not in entry_titles][:backfill_limit]
        else:
            singles = []
            backfill = await select_eligible_entities(graph_store, kb_id)

        stats = WikiStats(selected=len(singles) + len(backfill))
        # Dirty refresh runs per-entity: a handful at a time, not worth bundling.
        for row in singles:
            await _write_entry(store, wiki_store, vector_store, kb_id=kb_id, row=row, llm=llm, embedder=embedder, stats=stats)
        for bundle in plan_entry_batches(backfill):
            await _write_bundle(store, wiki_store, vector_store, kb_id=kb_id, rows=bundle, llm=llm, embedder=embedder, stats=stats)
        return stats
    finally:
        remaining = _IN_FLIGHT.get(kb_id, 0) - 1
        if remaining > 0:
            _IN_FLIGHT[kb_id] = remaining
        else:
            _IN_FLIGHT.pop(kb_id, None)
