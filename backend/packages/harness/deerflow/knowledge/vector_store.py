"""Qdrant vector store for the RAG knowledge base.

Four collections (spec §3.3–§3.5 + Phase-3 P6), all with named vectors ``dense``
(1024-dim COSINE) + ``sparse`` (Qdrant sparse vectors always score by dot
product, giving the DOT path):

- ``kb_chunks``       — chunk vectors; payload carries the ``chunk_id``
  pointer, filter fields (``kb_id``/``doc_id``/``entities``) and unindexed
  display metadata (``doc_name``/``heading_path``/``page``). Never the chunk
  text — text lives only in the business DB ``chunks`` table.
- ``kb_entities``     — entity name+description dense vectors (graph path).
- ``kb_wiki_entries`` — wiki entry vectors (payload: entry pointer + title).
- ``kb_manual_cards`` — manual knowledge card vectors (Phase-3 P6; payload:
  card pointer + title). Only cards with ``include_in_wiki_search`` on hold a
  point here (spec §8 可选混合).

The async client keeps the offline indexing worker and the online retrieval
tools off the event loop's blocking path.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    Fusion,
    FusionQuery,
    MatchAny,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    Prefetch,
    Record,
    ScoredPoint,
    SparseVector,
    SparseVectorParams,
    VectorParams,
)

#: Payload fields that get a KEYWORD index on ``kb_chunks`` (spec §3.3) —
#: only filter conditions are indexed; display metadata stays unindexed.
_CHUNKS_PAYLOAD_INDEXES: tuple[str, ...] = ("kb_id", "doc_id", "entities")


@dataclass(slots=True)
class ChunkUpsert:
    """One chunk vector + its Qdrant payload (no chunk text, by design)."""

    chunk_id: str
    kb_id: str
    doc_id: str
    dense: list[float]
    sparse: SparseVector
    doc_name: str = ""
    heading_path: list[str] = field(default_factory=list)
    page: int | None = None
    entities: list[str] = field(default_factory=list)


@dataclass(slots=True)
class EntityUpsert:
    """One entity's dense vector + payload for ``kb_entities`` (graph path).

    Dense-only by design: entity matching is a name+description semantic
    lookup, the sparse path adds nothing there.
    """

    name: str
    kb_id: str
    dense: list[float]
    type: str = ""
    description: str = ""


@dataclass(slots=True)
class WikiEntryUpsert:
    """One wiki entry's dense vector + pointer payload for ``kb_wiki_entries``.

    The full entry text stays in the business DB ``wiki_entries`` table — the
    payload only carries the ``entry_id`` pointer, ``title`` and ``kb_id``
    (spec §3.5 向量库存指针、正文存业务库).
    """

    entry_id: str
    kb_id: str
    title: str
    dense: list[float]


@dataclass(slots=True)
class ManualCardUpsert:
    """One manual card's dense vector + pointer payload for ``kb_manual_cards``
    (Phase-3 Batch-1 P6).

    Same pointer-not-text rule as wiki entries: the full card lives in the
    business DB ``manual_knowledge`` table; only cards whose
    ``include_in_wiki_search`` toggle is on get a point (spec §8 可选混合).
    """

    card_id: str
    kb_id: str
    title: str
    dense: list[float]


class KnowledgeVectorStore:
    """Qdrant facade for the knowledge collections."""

    def __init__(
        self,
        url: str | None = None,
        *,
        client: AsyncQdrantClient | None = None,
        collection_prefix: str = "kb",
        dense_size: int = 1024,
    ) -> None:
        if client is None:
            if url is None:
                raise ValueError("KnowledgeVectorStore requires a Qdrant url or a client")
            client = AsyncQdrantClient(url)
        self._client = client
        self._prefix = collection_prefix
        self._dense_size = dense_size

    @property
    def chunks_collection(self) -> str:
        return f"{self._prefix}_chunks"

    @property
    def entities_collection(self) -> str:
        return f"{self._prefix}_entities"

    @property
    def wiki_entries_collection(self) -> str:
        return f"{self._prefix}_wiki_entries"

    @property
    def manual_cards_collection(self) -> str:
        return f"{self._prefix}_manual_cards"

    @property
    def collection_names(self) -> tuple[str, ...]:
        return (self.chunks_collection, self.entities_collection, self.wiki_entries_collection, self.manual_cards_collection)

    @staticmethod
    def _point_id(chunk_id: str) -> str:
        """Deterministic UUID per chunk so re-upserts overwrite in place."""
        return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-chunk:{chunk_id}").hex

    @staticmethod
    def _entity_point_id(kb_id: str, name: str) -> str:
        """Deterministic UUID per (kb, entity) so re-embeds overwrite in place."""
        return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-entity:{kb_id}:{name}").hex

    @staticmethod
    def _wiki_point_id(entry_id: str) -> str:
        """Deterministic UUID per wiki entry so regenerations overwrite in place."""
        return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-wiki:{entry_id}").hex

    @staticmethod
    def _manual_card_point_id(card_id: str) -> str:
        """Deterministic UUID per manual card so re-embeds overwrite in place."""
        return uuid.uuid5(uuid.NAMESPACE_URL, f"deerflow:kb-manual-card:{card_id}").hex

    async def init_collections(self) -> None:
        """Create the collections + payload indexes, idempotently."""
        for name in self.collection_names:
            if await self._client.collection_exists(name):
                continue
            await self._client.create_collection(
                collection_name=name,
                vectors_config={"dense": VectorParams(size=self._dense_size, distance=Distance.COSINE)},
                sparse_vectors_config={"sparse": SparseVectorParams()},
            )
        # create_payload_index is itself idempotent (same name+schema → ok).
        for field_name in _CHUNKS_PAYLOAD_INDEXES:
            await self._client.create_payload_index(self.chunks_collection, field_name, PayloadSchemaType.KEYWORD)
        await self._client.create_payload_index(self.entities_collection, "kb_id", PayloadSchemaType.KEYWORD)
        await self._client.create_payload_index(self.wiki_entries_collection, "kb_id", PayloadSchemaType.KEYWORD)
        await self._client.create_payload_index(self.manual_cards_collection, "kb_id", PayloadSchemaType.KEYWORD)

    async def upsert_chunks(self, chunks: Sequence[ChunkUpsert]) -> int:
        points = [
            PointStruct(
                id=self._point_id(chunk.chunk_id),
                vector={"dense": chunk.dense, "sparse": chunk.sparse},
                payload={
                    "chunk_id": chunk.chunk_id,
                    "kb_id": chunk.kb_id,
                    "doc_id": chunk.doc_id,
                    "entities": chunk.entities,
                    "doc_name": chunk.doc_name,
                    "heading_path": chunk.heading_path,
                    "page": chunk.page,
                },
            )
            for chunk in chunks
        ]
        if not points:
            return 0
        await self._client.upsert(collection_name=self.chunks_collection, points=points)
        return len(points)

    async def hybrid_query(
        self,
        *,
        dense: list[float],
        sparse: SparseVector,
        kb_id: str,
        top_k: int = 5,
        per_path_limit: int = 20,
    ) -> list[ScoredPoint]:
        """Dense+sparse prefetch (per-path limit) fused with RRF, scoped to one KB."""
        kb_filter = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
        response = await self._client.query_points(
            collection_name=self.chunks_collection,
            prefetch=[
                Prefetch(query=dense, using="dense", filter=kb_filter, limit=per_path_limit),
                Prefetch(query=sparse, using="sparse", filter=kb_filter, limit=per_path_limit),
            ],
            query=FusionQuery(fusion=Fusion.RRF),
            limit=top_k,
            with_payload=True,
        )
        return response.points

    async def upsert_entities(self, entities: Sequence[EntityUpsert]) -> int:
        """Upsert entity dense vectors into ``kb_entities`` (graph path)."""
        points = [
            PointStruct(
                id=self._entity_point_id(entity.kb_id, entity.name),
                vector={"dense": entity.dense},
                payload={"kb_id": entity.kb_id, "name": entity.name, "type": entity.type, "description": entity.description},
            )
            for entity in entities
        ]
        if not points:
            return 0
        await self._client.upsert(collection_name=self.entities_collection, points=points)
        return len(points)

    async def delete_entities(self, kb_id: str, names: Sequence[str]) -> None:
        """Delete entity points from ``kb_entities`` (orphan cleanup after doc delete)."""
        if not names:
            return
        await self._client.delete(
            collection_name=self.entities_collection,
            points_selector=[self._entity_point_id(kb_id, name) for name in names],
        )

    async def set_chunk_entities(self, entities_by_chunk: Mapping[str, Sequence[str]]) -> None:
        """Backfill normalized entity names onto ``kb_chunks`` payloads.

        The reverse half of the graph↔vector two-way link (spec §3.4): the
        business-DB ``chunks.entities`` column is the source of truth feeding
        the chunk-drawer "关联实体" display; this payload mirror is its
        queryable twin and the foundation for a future true-mention marker
        (spec 2026-08-10 D4 保留边界).
        """
        for chunk_id, names in entities_by_chunk.items():
            await self._client.set_payload(
                collection_name=self.chunks_collection,
                payload={"entities": list(names)},
                points=FilterSelector(filter=Filter(must=[FieldCondition(key="chunk_id", match=MatchValue(value=chunk_id))])),
            )

    async def upsert_wiki_entries(self, entries: Sequence[WikiEntryUpsert]) -> int:
        """Upsert wiki-entry dense vectors into ``kb_wiki_entries`` (pointer payload only)."""
        points = [
            PointStruct(
                id=self._wiki_point_id(entry.entry_id),
                vector={"dense": entry.dense},
                payload={"entry_id": entry.entry_id, "kb_id": entry.kb_id, "title": entry.title},
            )
            for entry in entries
        ]
        if not points:
            return 0
        await self._client.upsert(collection_name=self.wiki_entries_collection, points=points)
        return len(points)

    async def delete_wiki_entries(self, kb_id: str, titles: Sequence[str]) -> None:
        """Delete wiki-entry points from ``kb_wiki_entries`` (spec §3.5 条目生命周期).

        Payload-filter delete (kb_id + title in list) rather than point-id
        recompute, so this module stays decoupled from the business-DB
        ``wiki_entry_id`` scheme. Idempotent: deleting an absent point is a
        no-op.
        """
        if not titles:
            return
        await self._client.delete(
            collection_name=self.wiki_entries_collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(key="kb_id", match=MatchValue(value=kb_id)),
                        FieldCondition(key="title", match=MatchAny(any=list(titles))),
                    ]
                )
            ),
        )

    async def query_entities(self, *, dense: list[float], kb_id: str, top_k: int = 5, score_threshold: float | None = None) -> list[ScoredPoint]:
        """Dense match over ``kb_entities`` (graph_search query-entity landing).

        ``score_threshold`` filters out far-neighbor noise: an unmatched query
        entity must surface nothing, not the closest unrelated entity."""
        response = await self._client.query_points(
            collection_name=self.entities_collection,
            query=dense,
            using="dense",
            query_filter=Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]),
            limit=top_k,
            score_threshold=score_threshold,
            with_payload=True,
        )
        return response.points

    async def query_wiki_entries(self, *, dense: list[float], kb_id: str, top_k: int = 3) -> list[ScoredPoint]:
        """Dense top-k over ``kb_wiki_entries``; payload carries the entry pointer."""
        response = await self._client.query_points(
            collection_name=self.wiki_entries_collection,
            query=dense,
            using="dense",
            query_filter=Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]),
            limit=top_k,
            with_payload=True,
        )
        return response.points

    async def query_manual_cards(self, *, dense: list[float], kb_id: str, top_k: int = 3) -> list[ScoredPoint]:
        """Dense top-k over ``kb_manual_cards`` (Phase-3 P6, spec §8 可选混合).

        Only toggle-on cards hold a point here, so every hit is a shared-pool
        candidate for the wiki path; payload carries the ``card_id`` pointer.
        """
        response = await self._client.query_points(
            collection_name=self.manual_cards_collection,
            query=dense,
            using="dense",
            query_filter=Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]),
            limit=top_k,
            with_payload=True,
        )
        return response.points

    async def get_chunk_vectors(self, chunk_ids: Sequence[str]) -> dict[str, list[float]]:
        """Retrieve dense chunk vectors by chunk ids (deterministic point ids).

        Powers the D1 evidence scoring: one batched retrieve, zero extra
        embedding calls. Missing points (deleted / not yet indexed) are
        skipped silently — their candidates simply score 0 downstream.
        """
        if not chunk_ids:
            return {}
        points = await self._client.retrieve(
            collection_name=self.chunks_collection,
            ids=[self._point_id(str(chunk_id)) for chunk_id in chunk_ids],
            with_vectors=True,
        )
        vectors: dict[str, list[float]] = {}
        for point in points:
            chunk_id = (point.payload or {}).get("chunk_id")
            vector = point.vector if isinstance(point.vector, dict) else {}
            dense = vector.get("dense")
            if chunk_id and dense:
                vectors[str(chunk_id)] = list(dense)
        return vectors

    async def get_entity_vectors(self, kb_id: str, names: Sequence[str]) -> dict[str, list[float]]:
        """Retrieve dense entity vectors by name (deterministic point ids).

        Powers the D2 semantic gate (neighbour pruning) and the D3 alias
        re-resolution. Missing points are skipped silently — a name without a
        vector scores 0 and is pruned downstream.
        """
        if not names:
            return {}
        points = await self._client.retrieve(
            collection_name=self.entities_collection,
            ids=[self._entity_point_id(kb_id, str(name)) for name in names],
            with_vectors=True,
        )
        vectors: dict[str, list[float]] = {}
        for point in points:
            name = (point.payload or {}).get("name")
            vector = point.vector if isinstance(point.vector, dict) else {}
            dense = vector.get("dense")
            if name and dense:
                vectors[str(name)] = list(dense)
        return vectors

    async def delete_chunks(self, chunk_ids: Sequence[str]) -> None:
        """Drop the listed chunk points (Task 5 收尾 single-chunk delete).

        Payload-filter delete (chunk_id in list), mirroring ``delete_by_doc``.
        Idempotent: deleting an absent point is a no-op.
        """
        if not chunk_ids:
            return
        await self._client.delete(
            collection_name=self.chunks_collection,
            points_selector=FilterSelector(filter=Filter(must=[FieldCondition(key="chunk_id", match=MatchAny(any=list(chunk_ids)))])),
        )

    async def scroll_collection(
        self,
        collection_name: str,
        kb_id: str,
        *,
        with_vectors: bool = False,
        batch_size: int = 512,
    ) -> list[Record]:
        """Page through every point of one KB in a collection (vector-space projection).

        Default is ids + payload only — the projection fetcher's sampling
        candidate source; dense vectors are fetched afterwards for the chosen
        subset via ``retrieve_vectors``, so a large KB never puts its full
        vector payload on the wire twice.
        """
        kb_filter = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
        records: list[Record] = []
        offset = None
        while True:
            batch, offset = await self._client.scroll(
                collection_name=collection_name,
                scroll_filter=kb_filter,
                limit=batch_size,
                offset=offset,
                with_payload=True,
                with_vectors=with_vectors,
            )
            records.extend(batch)
            if offset is None:
                return records

    async def retrieve_vectors(self, collection_name: str, point_ids: Sequence[str]) -> dict[str, list[float]]:
        """Batched dense-vector retrieve by raw point ids (projection fetcher).

        Keys are ``str(point_id)`` so callers can key by the scroll records'
        ids directly. Missing points (deleted between scroll and retrieve)
        are skipped silently.
        """
        if not point_ids:
            return {}
        points = await self._client.retrieve(collection_name=collection_name, ids=list(point_ids), with_vectors=True)
        vectors: dict[str, list[float]] = {}
        for point in points:
            vector = point.vector if isinstance(point.vector, dict) else {}
            dense = vector.get("dense")
            if dense:
                vectors[str(point.id)] = [float(v) for v in dense]
        return vectors

    async def upsert_manual_cards(self, cards: Sequence[ManualCardUpsert]) -> int:
        """Upsert manual-card dense vectors into ``kb_manual_cards`` (pointer payload only)."""
        points = [
            PointStruct(
                id=self._manual_card_point_id(card.card_id),
                vector={"dense": card.dense},
                payload={"card_id": card.card_id, "kb_id": card.kb_id, "title": card.title},
            )
            for card in cards
        ]
        if not points:
            return 0
        await self._client.upsert(collection_name=self.manual_cards_collection, points=points)
        return len(points)

    async def delete_manual_cards(self, card_ids: Sequence[str]) -> None:
        """Delete manual-card points (toggle-off / card delete). Idempotent."""
        if not card_ids:
            return
        await self._client.delete(
            collection_name=self.manual_cards_collection,
            points_selector=[self._manual_card_point_id(str(card_id)) for card_id in card_ids],
        )

    async def delete_by_doc(self, doc_id: str) -> None:
        """Drop all chunk points of one document (re-upload / delete path)."""
        await self._client.delete(
            collection_name=self.chunks_collection,
            points_selector=FilterSelector(filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))])),
        )

    async def delete_by_kb(self, kb_id: str) -> None:
        """Wipe every point of a KB across all collections (spec §3.7)."""
        kb_filter = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
        for name in self.collection_names:
            await self._client.delete(collection_name=name, points_selector=FilterSelector(filter=kb_filter))


def get_vector_store() -> KnowledgeVectorStore:
    """Build the store from the ``rag.qdrant_url`` app config section."""
    from deerflow.config.app_config import get_app_config

    return KnowledgeVectorStore(get_app_config().rag.qdrant_url)
