"""ORM models for the RAG knowledge-base subsystem.

Seven tables (spec §3.2–§3.5 + 2026-08-24 metrics visualization):

- ``knowledge_bases`` — one row per KB; Phase-1 is private-only but carries
  the ``owner_id`` / ``visibility`` hooks for the Phase-2 invite model.
- ``documents`` — uploaded files with the indexing status machine
  (``uploaded → parsing → chunking → indexing → ready / failed``).
- ``chunks`` — chunk text + per-chunk extract state (pending/done/empty/
  failed) for resume; Qdrant only ever holds vectors + a ``chunk_id`` pointer.
- ``graph_entities`` / ``graph_relations`` — the knowledge-graph path, with
  ``source_chunk_ids`` linking back to chunks.
- ``wiki_entries`` — generated wiki entries (dirty/ready incremental refresh).
- ``manual_knowledge`` — user-managed knowledge cards (Phase-3 P6): never
  auto-regenerated, opt-in wiki-search mixing via ``include_in_wiki_search``.
- ``eval_runs`` — evaluation run results (Layer 1 + Layer 2 metrics) for
  trend analysis and historical comparison (2026-08-24).

Registered with Alembic via ``deerflow.persistence.models``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint, false, text
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
    # Per-path sub-status (phase-2 batch-1 P3, spec 2026-08-11 §5):
    # {"vector": pending/indexing/done/failed, "graph": .../degraded/...}.
    # NULL on legacy rows — the frontend renders no hover then. The wiki leg
    # is NOT stored here: it is a library-level mirror injected at read time.
    path_status: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # File content hash (Task 11): SHA-256 for duplicate detection;
    # written at upload time, NULL on legacy rows (no backfill).
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
    # Phase-3 Batch-1 P2: manual edit timestamp (audit trail for slice editing)
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    # User annotations that survive dirty regeneration (Phase-3 Batch-1 P1).
    supplement_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ready / dirty (affected by newly indexed docs → regenerate, spec §3.5).
    status: Mapped[str] = mapped_column(String(16), default="ready", index=True)
    source_chunk_ids: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class ManualKnowledgeRow(Base):
    """User-managed knowledge card (Phase-3 Batch-1 P6, spec §8).

    Lives outside the AI wiki lifecycle: never auto-regenerated, never
    disqualified. ``include_in_wiki_search`` (default off) opts the card into
    the wiki retrieval path's shared top_k pool — toggled-on cards hold a
    dense vector in Qdrant ``kb_manual_cards``; off cards are management-only.
    """

    __tablename__ = "manual_knowledge"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(512))
    content: Mapped[str] = mapped_column(Text)
    include_in_wiki_search: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class EvalRunRow(Base):
    """Evaluation run result (2026-08-24 metrics visualization spec).

    Persists Layer2Report output for trend analysis and historical comparison.
    Layer 1 metrics (deterministic IR) and Layer 2 metrics (RAGAS + arch-specific)
    are stored as JSON for flexibility.
    """

    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # run_id
    kb_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16))  # completed / error / skipped

    # Layer 1 metrics: {category: {hit_rate, recall_at_k, mrr, path_accuracy}, summary: {...}}
    layer1_metrics: Mapped[dict] = mapped_column(JSON)

    # Layer 2 metrics: {ragas: {faithfulness, ...}, arch_specific: {citation_precision, ...}}
    layer2_metrics: Mapped[dict] = mapped_column(JSON)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Optional integrations
    langfuse_trace_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Baseline comparison (if compared against a baseline run)
    baseline_diff: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Run environment (spec v3): local / ci / nightly. CI runs stay out of the
    # default latest/trend read sets (``include_ci=true`` opts them back in).
    environment: Mapped[str] = mapped_column(String(16), default="local", server_default=text("'local'"))

    # Baseline marker (§3.1.3): the trend API's threshold line reads this row,
    # and ``--baseline auto`` diffs against it.
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())

    __table_args__ = (
        # At most one baseline row per KB: ``--mark-baseline`` clears the old
        # marker and sets the new one in a single transaction; this partial
        # unique index is the DB-level backstop. Must live in ORM
        # ``__table_args__`` (not just migration 0018) because the empty-DB
        # bootstrap path runs ``create_all`` + ``stamp head`` and never
        # executes the migration.
        Index(
            "uq_eval_runs_kb_baseline",
            "kb_id",
            unique=True,
            sqlite_where=text("is_baseline = true"),
            postgresql_where=text("is_baseline = true"),
        ),
    )
