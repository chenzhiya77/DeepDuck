/**
 * Pure derivations over the document table (spec §3.6): the bottom stats row
 * is aggregated client-side, and terminal-state classification is shared by
 * the polling hook and the status badge.
 */
import type { KnowledgeDocument } from "./types";

export interface DocumentStats {
  total: number;
  ready: number;
  failed: number;
  /** Documents in a non-terminal pipeline state (uploaded/parsing/chunking/indexing). */
  inProgress: number;
  totalBytes: number;
  totalChunks: number;
}

export function isDocumentTerminal(doc: Pick<KnowledgeDocument, "status">): boolean {
  return doc.status === "ready" || doc.status === "failed";
}

export function aggregateDocumentStats(docs: readonly KnowledgeDocument[]): DocumentStats {
  let ready = 0;
  let failed = 0;
  let inProgress = 0;
  let totalBytes = 0;
  let totalChunks = 0;
  for (const doc of docs) {
    if (doc.status === "ready") ready += 1;
    else if (doc.status === "failed") failed += 1;
    else inProgress += 1;
    totalBytes += doc.size_bytes;
    totalChunks += doc.chunk_count ?? 0;
  }
  return { total: docs.length, ready, failed, inProgress, totalBytes, totalChunks };
}

/** Polling cadence for the document list while any doc is mid-pipeline. */
export const DOCUMENTS_POLL_INTERVAL_MS = 3000;

/** TanStack Query ``refetchInterval`` decision for the documents query. */
export function documentsRefetchInterval(docs: readonly KnowledgeDocument[] | undefined): number | false {
  if (!docs) return false;
  return docs.some((doc) => !isDocumentTerminal(doc)) ? DOCUMENTS_POLL_INTERVAL_MS : false;
}

/** Human-readable byte size (1024-based, one decimal for KB+). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MB`;
  return `${(mib / 1024).toFixed(1)} GB`;
}
