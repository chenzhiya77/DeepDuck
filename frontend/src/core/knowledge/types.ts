/**
 * Knowledge-base (RAG) types mirroring the Task-8 gateway contract
 * (spec §5.3 / §3.2). Field names stay snake_case to match the API payload
 * exactly — these types are the wire format, not a view model.
 */

export interface KnowledgeBase {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  visibility: "private" | string;
  created_at: string;
}

/** Document status machine (spec §3.6): uploaded → parsing → chunking → indexing → ready / failed. */
export type KnowledgeDocumentStatus = "uploaded" | "parsing" | "chunking" | "indexing" | "ready" | "failed";

// ── P3 per-path sub-status (phase-2 batch-1, spec 2026-08-11 §5) ──────────

/** Vector leg: pending → indexing → done / failed. */
export type VectorPathState = "pending" | "indexing" | "done" | "failed" | string;
/** Graph leg adds "degraded" (partial extraction failure — same verdict source as the "graph degraded" error marker). */
export type GraphPathState = "pending" | "indexing" | "done" | "degraded" | "failed" | string;
/** Wiki leg: a library-level mirror injected at read time — identical for every document of the KB. */
export type WikiPathState = "pending" | "generating" | "ready" | "failed" | string;

/** Per-path indexing sub-status persisted on the document row (wiki mirrored library-wide). */
export interface DocumentPathStatus {
  vector: VectorPathState;
  graph: GraphPathState;
  wiki: WikiPathState;
}

export interface KnowledgeDocument {
  id: string;
  kb_id: string;
  uploader_id: string;
  name: string;
  size_bytes: number;
  storage_path: string;
  status: KnowledgeDocumentStatus;
  progress_percent: number;
  /** Null until indexing finished — the table renders "—" (spec §3.6). */
  chunk_count: number | null;
  /** Failure reason; also carries the "graph degraded" marker (spec §3.4). */
  error: string | null;
  /**
   * Per-path sub-status (P3). Null on legacy rows and before the indexing
   * stage — the status cell renders no hover breakdown then (spec §5 兼容).
   */
  path_status: DocumentPathStatus | null;
  /**
   * SHA-256 of the file content (Task 11 duplicate-upload interception).
   * Written at upload time; null on legacy rows (no backfill) — the upload
   * pre-check treats those as "hash unknown" and falls into the conflict
   * branch (replace / keep-both).
   */
  content_hash: string | null;
  created_at: string;
}

export interface KnowledgeChunk {
  chunk_id: string;
  doc_id: string;
  kb_id: string;
  chunk_index: number;
  text: string;
  heading_path: string[];
  page: number | null;
  token_count: number;
  entities: string[];
  extract_status: "pending" | "done" | "empty" | "failed" | string;
  /** Phase-3 Batch-1 P2: timestamp of last manual text edit (null = never edited). */
  last_edited_at: string | null;
}

export interface KnowledgeChunkPage {
  items: KnowledgeChunk[];
  total: number;
  offset: number;
  limit: number;
}

/** Phase-3 Batch-1 P5: delete impact preview response. */
export interface DeletePreviewResponse {
  orphaned_entities: string[];
  affected_entities: string[];
  relation_deletions: Array<{
    source: string;
    target: string;
    relation: string;
  }>;
}

export interface WikiGenerateAck {
  status: "enqueued" | string;
}

/** Wiki tab list item (phase-2 batch-1): summary-only, no full content. */
export interface WikiEntrySummary {
  id: string;
  title: string;
  summary: string;
  status: "ready" | "dirty" | string;
  updated_at: string;
}

/** Full wiki entry, fetched on demand for the entry drawer. */
export interface WikiEntryDetail {
  id: string;
  kb_id: string;
  title: string;
  content: string;
  /** User annotations that survive dirty re-generation (Phase-3 Batch-1 P1). */
  supplement_content: string | null;
  status: "ready" | "dirty" | string;
  source_chunk_ids: string[];
  updated_at: string;
}

/** Citation source carried by the retrieval tools' JSON output (spec §4.6). */
export interface KnowledgeCitation {
  chunk_id: string;
  doc_name: string;
  page: number | null;
  heading_path: string[];
  text: string;
  score: number;
  /**
   * Filled by the frontend parse layer from the tool name (phase-2 batch-1):
   * wiki_search → "wiki", hybrid/graph → "chunk". Undefined on legacy
   * citations — render those as "chunk".
   */
  source_type?: "chunk" | "wiki";
  /**
   * Backend-assigned citation numbers (rag citation_counter) — INTERNAL
   * handles, never shown to the user. A chunk recalled by multiple paths
   * (hybrid AND graph) carries every number it was assigned; the answer's
   * ``[n]`` marks resolve through these to this card, and the card's sorted
   * strip position becomes the display number actually rendered.
   */
  citation_nos?: number[];
}

// ── P1 recall test (phase-2 batch-1) ─────────────────────────────────────

export interface RecallVectorHit {
  chunk_id: string;
  doc_name: string;
  text: string;
  heading_path: string[];
  page: number | null;
  /** null when the reranker degraded to RRF order (schema deliberately nullable). */
  score: number | null;
  rank: number;
}

export interface RecallGraphEntity {
  name: string;
  type: string;
  description: string;
}

export interface RecallGraphRelation {
  source: string;
  target: string;
  relation: string;
  description: string;
}

export interface RecallGraphEvidence {
  chunk_id: string;
  doc_name: string;
  text: string;
  heading_path: string[];
  page: number | null;
  score: number;
}

export interface RecallWikiHit {
  entry_id: string;
  title: string;
  summary: string;
  score: number | null;
  rank: number;
}

export type RecallPathName = "vector" | "graph" | "wiki";

export interface RecallTestResponse {
  query: string;
  paths: {
    vector: { hits: RecallVectorHit[]; message: string };
    graph: {
      entities: RecallGraphEntity[];
      relations: RecallGraphRelation[];
      evidence: RecallGraphEvidence[];
      message: string;
    };
    wiki: { hits: RecallWikiHit[]; message: string };
  };
  /** Per-path score semantics — never compare scores across paths. */
  score_type: Record<RecallPathName, string>;
  elapsed_ms: Record<RecallPathName, number>;
}
