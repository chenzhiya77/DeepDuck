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
}

export interface KnowledgeChunkPage {
  items: KnowledgeChunk[];
  total: number;
  offset: number;
  limit: number;
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
