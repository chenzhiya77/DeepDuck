"""孤儿向量对账清扫（spec 2026-10-04-rag-orphan-vector-sweep-design.md）。

以业务库为准绳：按库滚动四集合 → 收集"业务行不存在"的候选 → 复核一遍 →
只删复核后仍缺失的点。两段式专门兜住卡片创建路径"向量先于行"的窗口
（knowledge_service.py:941-950）；其余三路写序=行先行（spec §2.2）。
不建持久记录、不碰业务行与文件；单集合失败记录后继续；幂等可重复。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_COLLECTION_KEYS: tuple[str, ...] = ("chunks", "entities", "wiki_entries", "manual_cards")
_CHUNK_CHECK_BATCH = 512


@dataclass(slots=True)
class SweepReport:
    kb_id: str
    scanned: dict[str, int] = field(default_factory=lambda: {key: 0 for key in _COLLECTION_KEYS})
    deleted: dict[str, int] = field(default_factory=lambda: {key: 0 for key in _COLLECTION_KEYS})
    skipped: dict[str, int] = field(default_factory=lambda: {key: 0 for key in _COLLECTION_KEYS})
    failed: list[str] = field(default_factory=list)


async def sweep_library(*, store, vector_store, graph_store, wiki_store, kb_id: str) -> SweepReport:
    report = SweepReport(kb_id=kb_id)
    steps = (
        ("chunks", _sweep_chunks),
        ("entities", _sweep_entities),
        ("wiki_entries", _sweep_wiki_entries),
        ("manual_cards", _sweep_manual_cards),
    )
    for key, step in steps:
        try:
            await step(report, store=store, vector_store=vector_store, graph_store=graph_store, wiki_store=wiki_store, kb_id=kb_id)
        except Exception:
            logger.exception("orphan sweep failed for kb %s collection %s; continuing", kb_id, key)
            report.failed.append(key)
    if any(report.deleted.values()):
        logger.info("orphan sweep kb=%s scanned=%s deleted=%s skipped=%s failed=%s", kb_id, report.scanned, report.deleted, report.skipped, report.failed)
    return report


async def _existing_chunk_ids(store, chunk_ids: list[str], kb_id: str) -> set[str]:
    found: set[str] = set()
    for start in range(0, len(chunk_ids), _CHUNK_CHECK_BATCH):
        batch = chunk_ids[start : start + _CHUNK_CHECK_BATCH]
        rows = await store.get_chunks_by_ids(batch, kb_id=kb_id)
        found.update(row["chunk_id"] for row in rows)
    return found


async def _sweep_chunks(report: SweepReport, *, store, vector_store, graph_store, wiki_store, kb_id: str) -> None:
    records = await vector_store.scroll_collection(vector_store.chunks_collection, kb_id)
    report.scanned["chunks"] = len(records)
    ids = sorted({(record.payload or {}).get("chunk_id") for record in records if (record.payload or {}).get("chunk_id")})
    if not ids:
        return
    live = await _existing_chunk_ids(store, ids, kb_id)
    candidates = [chunk_id for chunk_id in ids if chunk_id not in live]
    if not candidates:
        return
    confirmed_live = await _existing_chunk_ids(store, candidates, kb_id)
    still_orphans = [chunk_id for chunk_id in candidates if chunk_id not in confirmed_live]
    report.skipped["chunks"] = len(candidates) - len(still_orphans)
    if still_orphans:
        await vector_store.delete_chunks(still_orphans)
        report.deleted["chunks"] = len(still_orphans)


async def _sweep_entities(report: SweepReport, *, store, vector_store, graph_store, wiki_store, kb_id: str) -> None:
    records = await vector_store.scroll_collection(vector_store.entities_collection, kb_id)
    report.scanned["entities"] = len(records)
    names = sorted({(record.payload or {}).get("name") for record in records if (record.payload or {}).get("name")})
    if not names:
        return
    live = {row["name"] for row in await graph_store.list_entities(kb_id)}
    candidates = [name for name in names if name not in live]
    if not candidates:
        return
    live_again = {row["name"] for row in await graph_store.list_entities(kb_id)}
    still_orphans = [name for name in candidates if name not in live_again]
    report.skipped["entities"] = len(candidates) - len(still_orphans)
    if still_orphans:
        await vector_store.delete_entities(kb_id, still_orphans)
        report.deleted["entities"] = len(still_orphans)


async def _sweep_wiki_entries(report: SweepReport, *, store, vector_store, graph_store, wiki_store, kb_id: str) -> None:
    records = await vector_store.scroll_collection(vector_store.wiki_entries_collection, kb_id)
    report.scanned["wiki_entries"] = len(records)
    title_by_id: dict[str, str] = {}
    for record in records:
        payload = record.payload or {}
        if payload.get("entry_id"):
            title_by_id[payload["entry_id"]] = payload.get("title") or ""
    if not title_by_id:
        return
    live = {row["id"] for row in await wiki_store.list_entries(kb_id)}
    candidates = [entry_id for entry_id in title_by_id if entry_id not in live]
    if not candidates:
        return
    live_again = {row["id"] for row in await wiki_store.list_entries(kb_id)}
    still_orphans = [entry_id for entry_id in candidates if entry_id not in live_again]
    report.skipped["wiki_entries"] = len(candidates) - len(still_orphans)
    titles = [title_by_id[entry_id] for entry_id in still_orphans if title_by_id[entry_id]]
    if titles:
        await vector_store.delete_wiki_entries(kb_id, titles)
        report.deleted["wiki_entries"] = len(titles)


async def _sweep_manual_cards(report: SweepReport, *, store, vector_store, graph_store, wiki_store, kb_id: str) -> None:
    records = await vector_store.scroll_collection(vector_store.manual_cards_collection, kb_id)
    report.scanned["manual_cards"] = len(records)
    card_ids = sorted({(record.payload or {}).get("card_id") for record in records if (record.payload or {}).get("card_id")})
    if not card_ids:
        return
    candidates = [card_id for card_id in card_ids if await store.get_manual_card(card_id) is None]
    if not candidates:
        return
    still_orphans = [card_id for card_id in candidates if await store.get_manual_card(card_id) is None]
    report.skipped["manual_cards"] = len(candidates) - len(still_orphans)
    if still_orphans:
        await vector_store.delete_manual_cards(still_orphans)
        report.deleted["manual_cards"] = len(still_orphans)
