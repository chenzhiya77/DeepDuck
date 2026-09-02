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
  EvalQuestion,
  EvalQuestionCreateInput,
  EvalQuestionListResponse,
  EvalRunDetail,
  EvalRunListResponse,
  EvalTriggerInput,
  EvalTriggerResponse,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkPage,
  KnowledgeDocument,
  KnowledgeGraphResponse,
  ManualCardDetail,
  ManualCardsPage,
  MetricsOverview,
  RecallTestResponse,
  SynthesisStatus,
  SynthesisTriggerInput,
  SynthesisTriggerResponse,
  TrendQueryParams,
  TrendResponse,
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

/**
 * URL of a parser-extracted document asset (chunk markdown references
 * `images/…`; the gateway serves them from the document directory).
 * Pure URL builder for <img src> — never goes through the CSRF fetcher.
 */
export function documentFileUrl(kbId: string, docId: string, ref: string): string {
  const encodedRef = ref.split("/").map(encodeURIComponent).join("/");
  return kbUrl(kbId, `/documents/${encodeURIComponent(docId)}/files/${encodedRef}`);
}

export type WikiGenerateMode = "incremental" | "full";

export function generateWiki(kbId: string, mode: WikiGenerateMode = "incremental"): Promise<WikiGenerateAck> {
  return fetch(kbUrl(kbId, `/wiki/generate?mode=${mode}`), { method: "POST" }).then((r) =>
    readResponse<WikiGenerateAck>(r, "Failed to trigger wiki generation"),
  );
}

/**
 * 局部更新/重建（2026-09-02）：重生成手选的百科条目（按各自实体的当前切片
 * 重跑 LLM）。单条更新与单条重建在后端是同一操作，故共用此端点；返回与
 * ``generateWiki`` 相同的 202 ack（enqueued / already_running，与库级生成互斥）。
 */
export function regenerateWikiEntries(kbId: string, entryIds: string[]): Promise<WikiGenerateAck> {
  return fetch(kbUrl(kbId, "/wiki/regenerate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry_ids: entryIds }),
  }).then((r) => readResponse<WikiGenerateAck>(r, "Failed to regenerate wiki entries"));
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

/** GET /eval-runs/latest：两层各取最近一次 completed 非 ci 运行（spec §4.2）。 */
export function getLatestEvalMetrics(kbId: string): Promise<MetricsOverview> {
  return fetch(kbUrl(kbId, "/eval-runs/latest")).then((r) =>
    readResponse<MetricsOverview>(r, "Failed to fetch eval metrics overview"),
  );
}

/**
 * GET /eval-runs/trend：三粒度统一「周期末次」聚合（spec §4.2）。窗口参数
 * 按粒度配对（day→days_back / week→weeks_back / month→months_back），只回显
 * 当前粒度匹配的键；缺省走后端默认（30/12/6）。
 */
export function getEvalTrend(kbId: string, params: TrendQueryParams = { granularity: "day" }): Promise<TrendResponse> {
  const search = new URLSearchParams();
  search.set("granularity", params.granularity);
  if (params.granularity === "day" && params.days_back != null) {
    search.set("days_back", String(params.days_back));
  } else if (params.granularity === "week" && params.weeks_back != null) {
    search.set("weeks_back", String(params.weeks_back));
  } else if (params.granularity === "month" && params.months_back != null) {
    search.set("months_back", String(params.months_back));
  }
  return fetch(kbUrl(kbId, `/eval-runs/trend?${search.toString()}`)).then((r) =>
    readResponse<TrendResponse>(r, "Failed to fetch eval trend"),
  );
}

/** GET /eval-runs/{run_id}：单行完整 JSON，drawer 下钻数据源（spec §4.2）。 */
export function getEvalRun(kbId: string, runId: string): Promise<EvalRunDetail> {
  return fetch(kbUrl(kbId, `/eval-runs/${encodeURIComponent(runId)}`)).then((r) =>
    readResponse<EvalRunDetail>(r, "Failed to fetch eval run detail"),
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

// ── Eval question bank & run history (spec 2026-08-27 §4–§6) ─────────────

/** GET /eval/questions：读全量题库；文件不存在由后端回空表（spec §4.2）。 */
export function listEvalQuestions(kbId: string): Promise<EvalQuestionListResponse> {
  return fetch(kbUrl(kbId, "/eval/questions")).then((r) =>
    readResponse<EvalQuestionListResponse>(r, "Failed to fetch eval questions"),
  );
}

/** POST /eval/questions：新增一题，id 由服务端生成（201；schema 违例 422）。 */
export function createEvalQuestion(kbId: string, input: EvalQuestionCreateInput): Promise<EvalQuestion> {
  return fetch(kbUrl(kbId, "/eval/questions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => readResponse<EvalQuestion>(r, "Failed to create eval question"));
}

/** DELETE /eval/questions/{id}：删一题（204；id 不存在 404）。 */
export async function deleteEvalQuestion(kbId: string, questionId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/eval/questions/${encodeURIComponent(questionId)}`), {
    method: "DELETE",
  });
  await readEmptyResponse(response, "Failed to delete eval question");
}

/**
 * GET /eval-runs：历史列表 + 顶层 in_flight（spec §6.1）。默认排除 ci 行；
 * limit 超上限由后端 clamp，前端不重复限制。
 */
export function listEvalRuns(kbId: string, params: { limit?: number; include_ci?: boolean } = {}): Promise<EvalRunListResponse> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.include_ci) search.set("include_ci", "true");
  const qs = search.toString();
  return fetch(kbUrl(kbId, qs ? `/eval-runs?${qs}` : "/eval-runs")).then((r) =>
    readResponse<EvalRunListResponse>(r, "Failed to fetch eval runs"),
  );
}

/** POST /eval-runs：触发一次按需评测（202 幂等，spec §5.1 + 2026-09-01 B 方案）。
 *  空载荷 = L1 全量（后端默认，旧契约兼容）；``l1_l2`` / ``question_ids`` 见 EvalTriggerInput。 */
export function triggerEvalRun(kbId: string, input: EvalTriggerInput = {}): Promise<EvalTriggerResponse> {
  return fetch(kbUrl(kbId, "/eval-runs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => readResponse<EvalTriggerResponse>(r, "Failed to trigger eval run"));
}

// ── Question synthesis（2026-08-28 spec §6，Task 6–8）───────────────────

/** POST /eval/questions/synthesize：自底向上合成候选题（202 幂等；文档未就绪 409）。 */
export function triggerQuestionSynthesis(kbId: string, input: SynthesisTriggerInput): Promise<SynthesisTriggerResponse> {
  return fetch(kbUrl(kbId, "/eval/questions/synthesize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => readResponse<SynthesisTriggerResponse>(r, "Failed to trigger question synthesis"));
}

/** GET /eval/questions/synthesize：合成状态（in_progress + 暂存候选 + 元数据）。 */
export function getSynthesisStatus(kbId: string): Promise<SynthesisStatus> {
  return fetch(kbUrl(kbId, "/eval/questions/synthesize")).then((r) =>
    readResponse<SynthesisStatus>(r, "Failed to fetch synthesis status"),
  );
}

/** POST .../synthesize/{candidate_id}/accept：采纳候选入题库（201；未知候选 404）。 */
export function acceptSynthesisCandidate(kbId: string, candidateId: string): Promise<EvalQuestion> {
  return fetch(kbUrl(kbId, `/eval/questions/synthesize/${encodeURIComponent(candidateId)}/accept`), {
    method: "POST",
  }).then((r) => readResponse<EvalQuestion>(r, "Failed to accept synthesis candidate"));
}

/** DELETE .../synthesize/{candidate_id}：忽略候选（204；未知候选 404）。 */
export async function rejectSynthesisCandidate(kbId: string, candidateId: string): Promise<void> {
  const response = await fetch(kbUrl(kbId, `/eval/questions/synthesize/${encodeURIComponent(candidateId)}`), {
    method: "DELETE",
  });
  await readEmptyResponse(response, "Failed to reject synthesis candidate");
}
