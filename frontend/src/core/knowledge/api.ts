/**
 * REST client for the knowledge-base management API (spec §5.3).
 * Follows the `core/memory/api.ts` pattern: the shared fetcher owns CSRF +
 * credentials + 401 redirect; this module owns paths, bodies, and error
 * detail surfacing.
 */
import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import type {
  KnowledgeBase,
  KnowledgeChunkPage,
  KnowledgeDocument,
  RecallTestResponse,
  WikiEntryDetail,
  WikiEntrySummary,
  WikiGenerateAck,
} from "./types";

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (typeof record.msg === "string") return record.msg;
        }
        return null;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join("; ") : null;
  }
  return null;
}

async function readResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const detailMessage = formatErrorDetail(errorData.detail);
    throw new Error(detailMessage ?? `${fallbackMessage}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function readEmptyResponse(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const detailMessage = formatErrorDetail(errorData.detail);
    throw new Error(detailMessage ?? `${fallbackMessage}: ${response.statusText}`);
  }
}

function kbUrl(kbId: string, suffix = ""): string {
  return `${getBackendBaseURL()}/api/knowledge-bases/${encodeURIComponent(kbId)}${suffix}`;
}

export function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return fetch(`${getBackendBaseURL()}/api/knowledge-bases`).then((r) =>
    readResponse<KnowledgeBase[]>(r, "Failed to fetch knowledge bases"),
  );
}

export function createKnowledgeBase(input: { name: string; description?: string }): Promise<KnowledgeBase> {
  return fetch(`${getBackendBaseURL()}/api/knowledge-bases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, description: input.description ?? "" }),
  }).then((r) => readResponse<KnowledgeBase>(r, "Failed to create knowledge base"));
}

export function getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
  return fetch(kbUrl(kbId)).then((r) => readResponse<KnowledgeBase>(r, "Failed to fetch knowledge base"));
}

export function updateKnowledgeBase(
  kbId: string,
  patch: { name?: string; description?: string },
): Promise<KnowledgeBase> {
  return fetch(kbUrl(kbId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => readResponse<KnowledgeBase>(r, "Failed to update knowledge base"));
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId), { method: "DELETE" });
  return readEmptyResponse(response, "Failed to delete knowledge base");
}

export function listDocuments(kbId: string): Promise<KnowledgeDocument[]> {
  return fetch(kbUrl(kbId, "/documents")).then((r) =>
    readResponse<KnowledgeDocument[]>(r, "Failed to fetch documents"),
  );
}

export function uploadDocument(kbId: string, file: File): Promise<KnowledgeDocument> {
  const body = new FormData();
  body.append("file", file, file.name);
  // No explicit Content-Type: fetch must compose the multipart boundary.
  return fetch(kbUrl(kbId, "/documents"), { method: "POST", body }).then((r) =>
    readResponse<KnowledgeDocument>(r, "Failed to upload document"),
  );
}

export async function deleteDocument(kbId: string, docId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/documents/${encodeURIComponent(docId)}`), {
    method: "DELETE",
  });
  return readEmptyResponse(response, "Failed to delete document");
}

export function retryDocument(kbId: string, docId: string): Promise<KnowledgeDocument> {
  return fetch(kbUrl(kbId, `/documents/${encodeURIComponent(docId)}/retry`), {
    method: "POST",
  }).then((r) => readResponse<KnowledgeDocument>(r, "Failed to retry document"));
}

export function listDocumentChunks(
  kbId: string,
  docId: string,
  page: { offset: number; limit: number },
): Promise<KnowledgeChunkPage> {
  const params = new URLSearchParams({
    offset: String(page.offset),
    limit: String(page.limit),
  });
  return fetch(kbUrl(kbId, `/documents/${encodeURIComponent(docId)}/chunks?${params}`)).then((r) =>
    readResponse<KnowledgeChunkPage>(r, "Failed to fetch chunks"),
  );
}

export type WikiGenerateMode = "incremental" | "full";

export function generateWiki(kbId: string, mode: WikiGenerateMode = "incremental"): Promise<WikiGenerateAck> {
  return fetch(kbUrl(kbId, `/wiki/generate?mode=${mode}`), { method: "POST" }).then((r) =>
    readResponse<WikiGenerateAck>(r, "Failed to trigger wiki generation"),
  );
}

export function listWikiEntries(kbId: string): Promise<WikiEntrySummary[]> {
  return fetch(kbUrl(kbId, "/wiki/entries")).then((r) =>
    readResponse<WikiEntrySummary[]>(r, "Failed to fetch wiki entries"),
  );
}

export function getWikiEntry(kbId: string, entryId: string): Promise<WikiEntryDetail> {
  return fetch(kbUrl(kbId, `/wiki/entries/${encodeURIComponent(entryId)}`)).then((r) =>
    readResponse<WikiEntryDetail>(r, "Failed to fetch wiki entry"),
  );
}

export async function deleteWikiEntry(kbId: string, entryId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/wiki/entries/${encodeURIComponent(entryId)}`), {
    method: "DELETE",
  });
  return readEmptyResponse(response, "Failed to delete wiki entry");
}

export function recallTest(kbId: string, body: { query: string; top_k: number }): Promise<RecallTestResponse> {
  return fetch(kbUrl(kbId, "/recall-test"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => readResponse<RecallTestResponse>(r, "Failed to run recall test"));
}
