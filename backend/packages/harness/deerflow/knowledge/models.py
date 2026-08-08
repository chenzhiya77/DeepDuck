"""ORM models for the RAG knowledge-base subsystem.

Six tables (spec §3.2–§3.5):

- ``knowledge_bases`` — one row per KB; Phase-1 is private-only but carries
  the ``owner_id`` / ``visibility`` hooks for the Phase-2 invite model.
- ``documents`` — uploaded files with the indexing status machine
  (``uploaded → parsing → chunking → indexing → ready / failed``).
- ``chunks`` — chunk text + per-chunk extract state (pending/done/empty/
  failed) for resume; Qdrant only ever holds vectors + a ``chunk_id`` pointer.
- ``graph_entities`` / ``graph_relations`` — the knowledge-graph path, with
  ``source_chunk_ids`` linking back to chunks.
- ``wiki_entries`` — generated wiki entries (dirty/ready incremental refresh).

Registered with Alembic via ``deerflow.persistence.models``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from deerflow.persistence.base import Base


class KnowledgeBaseRow(Base):
    __tablename__ = "knowledge_bases"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 1: always "private". Phase 2 activates "shared" + kb_members.
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    # Phase-1 mandatory field (spec §3.6): equals the KB owner for now; shared
    # KBs in Phase 2 give it real uploader semantics.
    uploader_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(16), default="uploaded", index=True)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    # Backfilled when indexing finishes; NULL renders as "—" in the doc list.
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class ChunkRow(Base):
    __tablename__ = "chunks"

    # "{doc_id}#0042" — deterministic, unique per document.
    chunk_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(64), index=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    heading_path: Mapped[list] = mapped_column(JSON, default=list)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    # Normalized entity names backfilled by the graph path (spec §3.2).
    entities: Mapped[list] = mapped_column(JSON, default=list)
    # Extract state machine for resume: pending → done / empty / failed.
    extract_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    extract_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class GraphEntityRow(Base):
    __tablename__ = "graph_entities"
    # Normalized entity names are unique within a KB (LightRAG-style merge).
    __table_args__ = (UniqueConstraint("kb_id", "name", name="uq_graph_entities_kb_name"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_chunk_ids: Mapped[list] = mapped_column(JSON, default=list)
    # ready / dirty (partial source loss → re-summarize, spec §3.7).
    status: Mapped[str] = mapped_column(String(16), default="ready")


class GraphRelationRow(Base):
    __tablename__ = "graph_relations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(255))
    target: Mapped[str] = mapped_column(String(255))
    relation: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_chunk_ids: Mapped[list] = mapped_column(JSON, default=list)


class WikiEntryRow(Base):
    __tablename__ = "wiki_entries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512))
    content: Mapped[str] = mapped_column(Text)
    # ready / dirty (affected by newly indexed docs → regenerate, spec §3.5).
    status: Mapped[str] = mapped_column(String(16), default="ready", index=True)
    source_chunk_ids: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
