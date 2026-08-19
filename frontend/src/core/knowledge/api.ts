/**
 * REST client for the knowledge-base management API (spec §5.3).
 * Follows the `core/memory/api.ts` pattern: the shared fetcher owns CSRF +
 * credentials + 401 redirect; this module owns paths, bodies, and error
 * detail surfacing.
 */
import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import type {
  DeletePreviewResponse,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkPage,
  KnowledgeDocument,
  KnowledgeGraphResponse,
  ManualCardDetail,
  ManualCardsPage,
  RecallTestResponse,
  VectorProjectionAlgo,
  VectorProjectionQueryResult,
  VectorProjectionResponse,
  WikiEntriesPage,
  WikiEntryDetail,
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

/** Upload allowlist (Task 6, spec §6) — static data, cached indefinitely. */
export function getSupportedFormats(): Promise<{ suffixes: string[] }> {
  return fetch(`${getBackendBaseURL()}/api/knowledge-bases/supported-formats`).then((r) =>
    readResponse<{ suffixes: string[] }>(r, "Failed to fetch supported formats"),
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

/** GET /graph — 知识图谱可视化（2026-08-19 spec §4）：全量实体/关系 + 社区标注。 */
export function getKnowledgeGraph(kbId: string): Promise<KnowledgeGraphResponse> {
  return fetch(kbUrl(kbId, "/graph")).then((r) => readResponse<KnowledgeGraphResponse>(r, "Failed to fetch knowledge graph"));
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

export function listWikiEntries(kbId: string): Promise<WikiEntriesPage> {
  return fetch(kbUrl(kbId, "/wiki/entries")).then((r) =>
    readResponse<WikiEntriesPage>(r, "Failed to fetch wiki entries"),
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

/** Phase-3 Batch-1 P1: update wiki entry content and supplement layer. */
export async function updateWikiEntry(
  kbId: string,
  entryId: string,
  body: { content: string; supplement_content: string | null },
): Promise<WikiEntryDetail> {
  const response = await fetch(kbUrl(kbId, `/wiki/entries/${encodeURIComponent(entryId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<WikiEntryDetail>(response, "Failed to update wiki entry");
}

/** Task 5 收尾: delete one chunk (full cascade server-side: graph/wiki/vector/row). */
export async function deleteChunk(kbId: string, chunkId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/chunks/${encodeURIComponent(chunkId)}`), {
    method: "DELETE",
  });
  return readEmptyResponse(response, "Failed to delete chunk");
}

/** Phase-3 Batch-1 P2: update chunk text with re-embedding. */
export async function updateChunk(
  kbId: string,
  chunkId: string,
  body: { text: string },
): Promise<KnowledgeChunk> {
  const response = await fetch(kbUrl(kbId, `/chunks/${encodeURIComponent(chunkId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<KnowledgeChunk>(response, "Failed to update chunk");
}

/** Phase-3 Batch-1 P5: preview chunk deletion impact (dry-run). */
export async function previewChunkDeletion(
  kbId: string,
  body: { chunk_ids: string[] },
): Promise<DeletePreviewResponse> {
  const response = await fetch(kbUrl(kbId, "/chunks/delete-preview"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<DeletePreviewResponse>(response, "Failed to preview chunk deletion");
}

/** Phase-3 Batch-1 P3: re-extract entities for a single chunk. */
export async function reExtractChunk(kbId: string, chunkId: string): Promise<unknown> {
  const response = await fetch(kbUrl(kbId, `/chunks/${encodeURIComponent(chunkId)}/re-extract`), {
    method: "POST",
  });
  return readResponse<unknown>(response, "Failed to re-extract chunk");
}

export function recallTest(kbId: string, body: { query: string; top_k: number }): Promise<RecallTestResponse> {
  return fetch(kbUrl(kbId, "/recall-test"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => readResponse<RecallTestResponse>(r, "Failed to run recall test"));
}

// ── Phase-3 Batch-1 P6: manual knowledge cards (spec §8) ──────────────────

export function listManualCards(
  kbId: string,
  page: { offset: number; limit: number } = { offset: 0, limit: 50 },
): Promise<ManualCardsPage> {
  const params = new URLSearchParams({ offset: String(page.offset), limit: String(page.limit) });
  return fetch(kbUrl(kbId, `/manual-knowledge?${params}`)).then((r) =>
    readResponse<ManualCardsPage>(r, "Failed to fetch manual cards"),
  );
}

export function getManualCard(kbId: string, cardId: string): Promise<ManualCardDetail> {
  return fetch(kbUrl(kbId, `/manual-knowledge/${encodeURIComponent(cardId)}`)).then((r) =>
    readResponse<ManualCardDetail>(r, "Failed to fetch manual card"),
  );
}

export async function createManualCard(
  kbId: string,
  body: { title: string; content: string; tags?: string[]; include_in_wiki_search?: boolean },
): Promise<ManualCardDetail> {
  const response = await fetch(kbUrl(kbId, "/manual-knowledge"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<ManualCardDetail>(response, "Failed to create manual card");
}

export async function updateManualCard(
  kbId: string,
  cardId: string,
  body: { title?: string; content?: string; tags?: string[]; include_in_wiki_search?: boolean },
): Promise<ManualCardDetail> {
  const response = await fetch(kbUrl(kbId, `/manual-knowledge/${encodeURIComponent(cardId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<ManualCardDetail>(response, "Failed to update manual card");
}

export async function deleteManualCard(kbId: string, cardId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/manual-knowledge/${encodeURIComponent(cardId)}`), {
    method: "DELETE",
  });
  return readEmptyResponse(response, "Failed to delete manual card");
}

// ── 向量空间可视化（2026-08-15 spec §7）────────────────────────────────────

/**
 * GET /vector-projection query params. Absent keys fall through to the server
 * defaults (collections=all four, algo=pca, dims=2, sample_size=5000); the
 * server clamps sample_size to [100, 10000].
 */
export interface VectorProjectionParams {
  collections?: readonly string[];
  algo?: VectorProjectionAlgo;
  dims?: 2 | 3;
  sampleSize?: number;
  /** Bypass the fingerprint comparison and recompute (spec §6 escape hatch). */
  refresh?: boolean;
}

/** 视图参数 → query string（GET 投影与 POST query 投影共用——缓存键对齐）。 */
function projectionSearchParams(params: VectorProjectionParams): string {
  const search = new URLSearchParams();
  if (params.collections && params.collections.length > 0) {
    search.set("collections", params.collections.join(","));
  }
  if (params.algo) {
    search.set("algo", params.algo);
  }
  if (params.dims) {
    search.set("dims", String(params.dims));
  }
  if (params.sampleSize !== undefined) {
    search.set("sample_size", String(params.sampleSize));
  }
  if (params.refresh) {
    search.set("refresh", "true");
  }
  return search.toString();
}

export function getVectorProjection(
  kbId: string,
  params: VectorProjectionParams = {},
): Promise<VectorProjectionResponse> {
  const qs = projectionSearchParams(params);
  return fetch(kbUrl(kbId, qs ? `/vector-projection?${qs}` : "/vector-projection")).then((r) =>
    readResponse<VectorProjectionResponse>(r, "Failed to fetch vector projection"),
  );
}

/**
 * POST /vector-projection/query: transform raw question text through the
 * cached PCA model (409 when no projection is cached / the cached one is
 * umap). Never triggers a projection compute server-side.
 *
 * ``params`` 必须与当前投影视图一致：服务端缓存键含 collections/algo/dims/
 * sample_size，缺省回落默认值 → peek 落空 409（联动静默不渲染的修复）。
 */
export async function projectVectorQuery(
  kbId: string,
  text: string,
  params: VectorProjectionParams = {},
): Promise<VectorProjectionQueryResult> {
  const qs = projectionSearchParams(params);
  const response = await fetch(
    kbUrl(kbId, qs ? `/vector-projection/query?${qs}` : "/vector-projection/query"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  return readResponse<VectorProjectionQueryResult>(response, "Failed to project query");
}
