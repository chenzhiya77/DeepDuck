"""SQLite graph store + NetworkX in-memory loader (spec §3.4).

Persistence choice per the spec's storage table: business-DB two tables
(``graph_entities`` / ``graph_relations``) + NetworkX for in-memory compute —
no extra container. Same-name entities merge LightRAG-style inside one KB:
descriptions append (deduped per fragment) and ``source_chunk_ids`` union, so
re-indexing or incremental documents never trigger a full graph rebuild. Uniqueness scope
is ``(kb_id, name)`` / ``(kb_id, source, target, relation)`` — two KBs keep
independent graphs.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import networkx as nx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from deerflow.knowledge.graph.extractor import ExtractedEntity, ExtractedRelation
from deerflow.knowledge.models import GraphEntityRow, GraphRelationRow


def _entity_id(kb_id: str, name: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-entity:{kb_id}:{name}").hex


def _relation_id(kb_id: str, source: str, target: str, relation: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-relation:{kb_id}:{source}:{target}:{relation}").hex


def _merge_text(existing: str | None, extra: str) -> str:
    """Append-only fragment merge: ``extra`` fragments not already present are added."""
    parts = [part for part in (existing or "").split("\n") if part]
    for fragment in extra.split("\n"):
        if fragment and fragment not in parts:
            parts.append(fragment)
    return "\n".join(parts)


def _merge_chunk_ids(existing: list, chunk_id: str) -> list:
    ids = list(existing or [])
    if chunk_id not in ids:
        ids.append(chunk_id)
    return ids


class GraphStore:
    """CRUD + merge facade over the two graph tables."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._sf = session_factory

    async def upsert_entities(self, kb_id: str, entities: Sequence[ExtractedEntity], *, chunk_id: str) -> None:
        if not entities:
            return
        async with self._sf() as session:
            for entity in entities:
                row = await session.get(GraphEntityRow, _entity_id(kb_id, entity.name))
                if row is None:
                    session.add(
                        GraphEntityRow(
                            id=_entity_id(kb_id, entity.name),
                            kb_id=kb_id,
                            name=entity.name,
                            type=entity.type,
                            description=entity.description,
                            source_chunk_ids=[chunk_id],
                            status="ready",
                        )
                    )
                else:
                    if entity.type and not row.type:
                        row.type = entity.type
                    row.description = _merge_text(row.description, entity.description)
                    row.source_chunk_ids = _merge_chunk_ids(row.source_chunk_ids, chunk_id)
            await session.commit()

    async def upsert_relations(self, kb_id: str, relations: Sequence[ExtractedRelation], *, chunk_id: str) -> None:
        if not relations:
            return
        async with self._sf() as session:
            for relation in relations:
                row = await session.get(GraphRelationRow, _relation_id(kb_id, relation.source, relation.target, relation.relation))
                if row is None:
                    session.add(
                        GraphRelationRow(
                            id=_relation_id(kb_id, relation.source, relation.target, relation.relation),
                            kb_id=kb_id,
                            source=relation.source,
                            target=relation.target,
                            relation=relation.relation,
                            description=relation.description,
                            source_chunk_ids=[chunk_id],
                        )
                    )
                else:
                    row.description = _merge_text(row.description, relation.description)
                    row.source_chunk_ids = _merge_chunk_ids(row.source_chunk_ids, chunk_id)
            await session.commit()

    async def list_entities(self, kb_id: str) -> list[dict[str, Any]]:
        stmt = select(GraphEntityRow).where(GraphEntityRow.kb_id == kb_id).order_by(GraphEntityRow.name)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [row.to_dict() for row in result.scalars().all()]

    async def list_relations(self, kb_id: str) -> list[dict[str, Any]]:
        stmt = select(GraphRelationRow).where(GraphRelationRow.kb_id == kb_id).order_by(GraphRelationRow.source, GraphRelationRow.target)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [row.to_dict() for row in result.scalars().all()]

    async def remove_chunk_contributions(self, kb_id: str, chunk_ids: Sequence[str]) -> tuple[list[str], list[str]]:
        """Remove a set of chunks' contributions from the graph (document delete/retry).

        For every entity/relation in this KB, the given chunk ids are removed
        from ``source_chunk_ids``. Entities left with zero sources are orphan
        nodes and deleted outright (their relations go with them); entities
        that still have other sources survive. Relations left with zero
        sources are deleted.

        Returns ``(orphaned_entity_names, affected_entity_names)`` — callers
        delete the orphans' vectors from ``kb_entities`` and mark the
        affected entities' wiki entries dirty (spec §3.7 级联删除).
        """
        if not chunk_ids:
            return [], []
        targets = set(chunk_ids)
        orphaned: list[str] = []
        affected: list[str] = []
        async with self._sf() as session:
            entity_rows = (await session.execute(select(GraphEntityRow).where(GraphEntityRow.kb_id == kb_id))).scalars().all()
            for row in entity_rows:
                remaining = [cid for cid in (row.source_chunk_ids or []) if cid not in targets]
                if len(remaining) == len(row.source_chunk_ids or []):
                    continue
                if not remaining:
                    orphaned.append(row.name)
                    await session.delete(row)
                else:
                    affected.append(row.name)
                    row.source_chunk_ids = remaining
            relation_rows = (await session.execute(select(GraphRelationRow).where(GraphRelationRow.kb_id == kb_id))).scalars().all()
            for row in relation_rows:
                if row.source in orphaned or row.target in orphaned:
                    await session.delete(row)
                    continue
                remaining = [cid for cid in (row.source_chunk_ids or []) if cid not in targets]
                if len(remaining) != len(row.source_chunk_ids or []) and not remaining:
                    await session.delete(row)
                elif len(remaining) != len(row.source_chunk_ids or []):
                    row.source_chunk_ids = remaining
            await session.commit()
        return orphaned, affected

    async def load_networkx(self, kb_id: str) -> nx.DiGraph:
        """Load the KB graph into memory. Multiple relations between the same
        endpoint pair collapse into one edge whose attributes join them
        (``relation`` fragments joined by ``、``) — DiGraph keeps traversal
        simple for the 1–2 hop online expansion."""
        graph = nx.DiGraph()
        entities = await self.list_entities(kb_id)
        relations = await self.list_relations(kb_id)
        for row in entities:
            graph.add_node(
                row["name"],
                type=row.get("type") or "",
                description=row.get("description") or "",
                source_chunk_ids=list(row.get("source_chunk_ids") or []),
                status=row.get("status") or "ready",
            )
        for row in relations:
            source, target = row["source"], row["target"]
            if graph.has_edge(source, target):
                edge = graph[source][target]
                if row["relation"] not in edge["relation"]:
                    edge["relation"] = f"{edge['relation']}、{row['relation']}"
                edge["description"] = _merge_text(edge["description"], row.get("description") or "")
                edge["source_chunk_ids"] = sorted(set(edge["source_chunk_ids"]) | set(row.get("source_chunk_ids") or []))
            else:
                graph.add_edge(
                    source,
                    target,
                    relation=row["relation"],
                    description=row.get("description") or "",
                    source_chunk_ids=list(row.get("source_chunk_ids") or []),
                )
        return graph
