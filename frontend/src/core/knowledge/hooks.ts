/**
 * TanStack Query hooks for the knowledge API. Polling cadence lives in the
 * pure `documentsRefetchInterval` (document-stats.ts) so the wiring here
 * stays trivially testable.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import * as api from "./api";
import { documentsRefetchInterval } from "./document-stats";
import { evalRunsRefetchInterval } from "./eval-run-status";
import type {
  EvalQuestionCreateInput,
  EvalQuestionListResponse,
  EvalRunDetail,
  EvalRunListResponse,
  MetricsOverview,
  TrendQueryParams,
  TrendResponse,
} from "./types";
import { wikiEntriesRefetchInterval } from "./wiki-status";

type EvalGranularity = TrendQueryParams["granularity"];

export function knowledgeBasesKey() {
  return ["knowledge-bases"] as const;
}

export function knowledgeDocumentsKey(kbId: string) {
  return ["knowledge-bases", kbId, "documents"] as const;
}

/** 知识图谱（2026-08-19 spec §4）：端点无参数维度，键即 kb 粒度。 */
export function knowledgeGraphKey(kbId: string) {
  return ["knowledge-bases", kbId, "graph"] as const;
}

export function knowledgeChunksKey(kbId: string, docId: string, offset: number, limit: number) {
  return ["knowledge-bases", kbId, "documents", docId, "chunks", { offset, limit }] as const;
}

export function useKnowledgeBases() {
  return useQuery({ queryKey: knowledgeBasesKey(), queryFn: api.listKnowledgeBases });
}

export function supportedFormatsKey() {
  return ["knowledge-bases", "supported-formats"] as const;
}

/** Upload allowlist (Task 6): static data — never goes stale within a session. */
export function useSupportedFormats() {
  return useQuery({
    queryKey: supportedFormatsKey(),
    queryFn: api.getSupportedFormats,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createKnowledgeBase,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
    },
  });
}

export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, patch }: { kbId: string; patch: { name?: string; description?: string } }) =>
      api.updateKnowledgeBase(kbId, patch),
    onSuccess: (_data, { kbId }) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => api.deleteKnowledgeBase(kbId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
    },
  });
}

export function useDocuments(kbId: string | null) {
  return useQuery({
    queryKey: knowledgeDocumentsKey(kbId ?? ""),
    queryFn: () => api.listDocuments(kbId!),
    enabled: kbId !== null,
    refetchInterval: (query) => documentsRefetchInterval(query.state.data),
  });
}

export function useUploadDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadDocument(kbId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDeleteDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.deleteDocument(kbId, docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useRetryDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.retryDocument(kbId, docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDocumentChunks(kbId: string | null, docId: string | null, offset: number, limit: number) {
  return useQuery({
    queryKey: knowledgeChunksKey(kbId ?? "", docId ?? "", offset, limit),
    queryFn: () => api.listDocumentChunks(kbId!, docId!, { offset, limit }),
    enabled: kbId !== null && docId !== null,
  });
}

export function useGenerateWiki(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: api.WikiGenerateMode) => api.generateWiki(kbId, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
      // The 202 ack returns before the background asyncio task flips the
      // in-flight flag, so the immediate refetch can still read idle. One
      // delayed re-invalidation closes that gap — after it lands on
      // "generating", the entries query's refetchInterval takes over.
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) }), 1000);
    },
  });
}

export function knowledgeWikiEntriesKey(kbId: string) {
  return ["knowledge-bases", kbId, "wiki-entries"] as const;
}

/** 评测数据（2026-08-24 spec §5，plan Task 5）：latest 无参数维度，键即 kb 粒度。 */
export function knowledgeEvalLatestKey(kbId: string) {
  return ["knowledge-bases", kbId, "eval-runs", "latest"] as const;
}

/** 趋势查询键含粒度——切粒度即换键自动重新请求（plan Task 5）。 */
export function knowledgeEvalTrendKey(kbId: string, granularity: EvalGranularity) {
  return ["knowledge-bases", kbId, "eval-runs", "trend", { granularity }] as const;
}

/** 单次运行详情键（drawer 下钻，plan Task 6）：runId 定位。 */
export function knowledgeEvalRunKey(kbId: string, runId: string) {
  return ["knowledge-bases", kbId, "eval-runs", "detail", runId] as const;
}

/** 题库键（2026-08-27 spec §4.2，plan Task 4）：无分页维度，键即 kb 粒度。 */
export function knowledgeEvalQuestionsKey(kbId: string) {
  return ["knowledge-bases", kbId, "eval-questions"] as const;
}

/** 历史列表键（spec §6.1）：含顶层 in_flight，与 detail/latest/trend 键互斥。 */
export function knowledgeEvalRunsKey(kbId: string) {
  return ["knowledge-bases", kbId, "eval-runs", "history"] as const;
}

/**
 * 评测数据分钟级不变：30s 内 keep-alive 来回切 tab 不重复请求（plan Task 5）。
 */
const EVAL_STALE_TIME_MS = 30_000;

/**
 * 指标总览（GET /eval-runs/latest）。Lazy: the caller gates with ``enabled``
 * so the fetch only fires once the eval tab is first activated — keep-alive
 * panes stay mounted, so without the gate every kb page load would fetch
 * eagerly（useWikiEntries / useVectorProjection 先例）.
 */
export function useMetricsOverview(kbId: string | null, enabled = true): UseQueryResult<MetricsOverview> {
  return useQuery({
    queryKey: knowledgeEvalLatestKey(kbId ?? ""),
    queryFn: () => api.getLatestEvalMetrics(kbId!),
    enabled: enabled && kbId !== null,
    staleTime: EVAL_STALE_TIME_MS,
  });
}

/** 指标趋势（GET /eval-runs/trend），粒度进 queryKey。 */
export function useEvalTrend(
  kbId: string | null,
  granularity: EvalGranularity,
  enabled = true,
): UseQueryResult<TrendResponse> {
  return useQuery({
    queryKey: knowledgeEvalTrendKey(kbId ?? "", granularity),
    queryFn: () => api.getEvalTrend(kbId!, { granularity }),
    enabled: enabled && kbId !== null,
    staleTime: EVAL_STALE_TIME_MS,
  });
}

/**
 * 单次运行详情（GET /eval-runs/{run_id}）：runId 定位，null 即禁用——
 * drawer 关闭后不残留请求（plan Task 6）。
 */
export function useEvalRun(kbId: string | null, runId: string | null): UseQueryResult<EvalRunDetail> {
  return useQuery({
    queryKey: knowledgeEvalRunKey(kbId ?? "", runId ?? ""),
    queryFn: () => api.getEvalRun(kbId!, runId!),
    enabled: kbId !== null && runId !== null,
  });
}

// ── 评测二期（2026-08-27 spec §4–§6，plan Task 4）────────────────────────

/** 题库列表（GET /eval/questions），enabled 由 eval tab 激活下发。 */
export function useEvalQuestions(kbId: string | null, enabled = true): UseQueryResult<EvalQuestionListResponse> {
  return useQuery({
    queryKey: knowledgeEvalQuestionsKey(kbId ?? ""),
    queryFn: () => api.listEvalQuestions(kbId!),
    enabled: enabled && kbId !== null,
    staleTime: EVAL_STALE_TIME_MS,
  });
}

/** 新增考题；成功失效题库缓存（表格即时见新题）。 */
export function useAddEvalQuestion(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalQuestionCreateInput) => api.createEvalQuestion(kbId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeEvalQuestionsKey(kbId) });
    },
  });
}

/** 删除考题；成功失效题库缓存。 */
export function useDeleteEvalQuestion(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => api.deleteEvalQuestion(kbId, questionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeEvalQuestionsKey(kbId) });
    },
  });
}

/**
 * 历史列表（GET /eval-runs）：轮询由顶层 in_flight 驱动（eval-run-status
 * 纯函数），drain 后停轮询——运行完成行的刷新走 drain 边 invalidate（§5.2）。
 */
export function useEvalRuns(kbId: string | null, enabled = true): UseQueryResult<EvalRunListResponse> {
  return useQuery({
    queryKey: knowledgeEvalRunsKey(kbId ?? ""),
    queryFn: () => api.listEvalRuns(kbId!),
    enabled: enabled && kbId !== null,
    refetchInterval: (query) => evalRunsRefetchInterval(query.state.data),
  });
}

/**
 * 触发一次按需 Layer 1 评测：202 响应原样透传（enqueued / already_running
 * 由调用方消费成不同 toast）；行数据的刷新不在这里 invalidate——统一走
 * drain 边，避免 POST 与首次轮询双重请求。
 */
export function useTriggerEvalRun(kbId: string) {
  return useMutation({
    mutationFn: () => api.triggerEvalRun(kbId),
  });
}

/**
 * Wiki tab listing (phase-2 batch-1). Lazy: the caller gates with
 * ``enabled`` so the list only loads once the tab is first activated —
 * keep-alive panes stay mounted, so without the gate every tab would fetch
 * eagerly.
 */
export function useWikiEntries(kbId: string | null, enabled = true) {
  return useQuery({
    queryKey: knowledgeWikiEntriesKey(kbId ?? ""),
    queryFn: () => api.listWikiEntries(kbId!),
    enabled: enabled && kbId !== null,
    // Poll only while a generation run is in flight (wiki 更新状态可见,
    // 2026-08-14) — same 3s cadence as the documents query; idle never polls.
    refetchInterval: (query) => wikiEntriesRefetchInterval(query.state.data),
  });
}

/** Full entry text for the drawer; null-gated until the drawer opens. */
export function useWikiEntry(kbId: string | null, entryId: string | null) {
  return useQuery({
    queryKey: [...knowledgeWikiEntriesKey(kbId ?? ""), entryId ?? ""] as const,
    queryFn: () => api.getWikiEntry(kbId!, entryId!),
    enabled: kbId !== null && entryId !== null,
  });
}

/**
 * Manual single-entry delete (Task 13). Regeneration semantics: an eligible
 * entity's entry comes back on the next generation run (a reset); only
 * disqualified/vanished entities' entries stay deleted.
 */
export function useDeleteWikiEntry(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.deleteWikiEntry(kbId, entryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
    },
  });
}

/** Phase-3 Batch-1 P1: update wiki entry (main content + supplement layer). */
export function useUpdateWikiEntry(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: { content: string; supplement_content: string | null } }) =>
      api.updateWikiEntry(kbId, entryId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
    },
  });
}

/** Phase-3 Batch-1 P2: update chunk text with re-embedding. */
export function useUpdateChunk(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chunkId, body }: { chunkId: string; body: { text: string } }) => api.updateChunk(kbId, chunkId, body),
    onSuccess: () => {
      // Invalidate all chunk queries for this KB (any doc might contain this chunk)
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kbId, "documents"] });
    },
  });
}

/** Phase-3 Batch-1 P5: preview chunk deletion impact (dry-run). */
export function usePreviewChunkDeletion(kbId: string) {
  return useMutation({
    mutationFn: (body: { chunk_ids: string[] }) => api.previewChunkDeletion(kbId, body),
  });
}

/** Task 5 收尾: delete a single chunk (cascade runs server-side). */
export function useDeleteChunk(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chunkId: string) => api.deleteChunk(kbId, chunkId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kbId, "documents"] });
    },
  });
}

/** Phase-3 Batch-1 P3: re-extract entities for a single chunk. */
export function useReExtractChunk(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chunkId: string) => api.reExtractChunk(kbId, chunkId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kbId, "documents"] });
    },
  });
}

/**
 * P1 recall test (phase-2 batch-1): a mutation, not a query — each run hits
 * the live retrieval chain (embedding + rerank + entity-extraction LLM), so
 * results must never be cached/refetched implicitly.
 */
export function useRecallTest(kbId: string) {
  return useMutation({
    mutationFn: (body: { query: string; top_k: number }) => api.recallTest(kbId, body),
  });
}

// ── Phase-3 Batch-1 P6: manual knowledge cards (spec §8) ──────────────────

export function knowledgeManualCardsKey(kbId: string) {
  return ["knowledge-bases", kbId, "manual-cards"] as const;
}

/** Manual card list. Lazy: gated by ``enabled`` (the wiki tab's collapsible
 * card section only fetches once expanded). */
export function useManualCards(kbId: string | null, enabled = true) {
  return useQuery({
    queryKey: knowledgeManualCardsKey(kbId ?? ""),
    queryFn: () => api.listManualCards(kbId!),
    enabled: enabled && kbId !== null,
  });
}

/** Full card for the editor dialog; null-gated until an edit opens. */
export function useManualCard(kbId: string | null, cardId: string | null) {
  return useQuery({
    queryKey: [...knowledgeManualCardsKey(kbId ?? ""), cardId ?? ""] as const,
    queryFn: () => api.getManualCard(kbId!, cardId!),
    enabled: kbId !== null && cardId !== null,
  });
}

export function useCreateManualCard(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; content: string; tags?: string[]; include_in_wiki_search?: boolean }) =>
      api.createManualCard(kbId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeManualCardsKey(kbId) });
    },
  });
}

export function useUpdateManualCard(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardId,
      body,
    }: {
      cardId: string;
      body: { title?: string; content?: string; tags?: string[]; include_in_wiki_search?: boolean };
    }) => api.updateManualCard(kbId, cardId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeManualCardsKey(kbId) });
    },
  });
}

export function useDeleteManualCard(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => api.deleteManualCard(kbId, cardId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeManualCardsKey(kbId) });
    },
  });
}

// ── 向量空间可视化（2026-08-15 spec §7）────────────────────────────────────

export function knowledgeVectorProjectionKey(kbId: string, params: api.VectorProjectionParams = {}) {
  return ["knowledge-bases", kbId, "vector-projection", params] as const;
}

/**
 * Projection query. Lazy like the wiki list: gated by ``enabled`` so the
 * fetch only fires once the vectors tab is first activated — keep-alive
 * panes stay mounted, so without the gate it would fetch eagerly. The
 * server-side fingerprint cache makes repeat activations cheap.
 */
export function useVectorProjection(kbId: string | null, params: api.VectorProjectionParams = {}, enabled = true) {
  return useQuery({
    queryKey: knowledgeVectorProjectionKey(kbId ?? "", params),
    queryFn: () => api.getVectorProjection(kbId!, params),
    enabled: enabled && kbId !== null,
  });
}

/**
 * 知识图谱（2026-08-19 spec §4 P2）：tab 激活才拉取（lazy 门控，对齐
 * useVectorProjection 先例）。无参数维度——端点不做缓存，每次现算，
 * React Query 的 staleTime 默认即可。
 */
export function useKnowledgeGraph(kbId: string | null, enabled = true) {
  return useQuery({
    queryKey: knowledgeGraphKey(kbId ?? ""),
    queryFn: () => api.getKnowledgeGraph(kbId!),
    enabled: enabled && kbId !== null,
  });
}

/**
 * Query-text overlay projection: a mutation, not a query (same discipline as
 * the recall test) — each call hits the live embedding model, results are
 * never cached/refetched implicitly.
 *
 * ``params`` 必须镜像当前投影视图（collections/algo/dims）：服务端缓存键含
 * 这些维度，缺省回落默认值 → peek 落空 409（P6 联动静默不渲染的修复）。
 */
export function useProjectVectorQuery(kbId: string, params: api.VectorProjectionParams = {}) {
  return useMutation({
    mutationFn: (text: string) => api.projectVectorQuery(kbId, text, params),
  });
}

/**
 * 重新计算（Task 7）：直打 `refresh=true` 强制重算，成功后把新数据写回
 * 主 queryKey 缓存——单一缓存键，不产生 refresh 副本，画布随缓存更新自动
 * 刷新。refresh 永不进 `useVectorProjection` 的常规参数（否则每次轮询都
 * 重算）。
 */
export function useRecomputeVectorProjection(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: api.VectorProjectionParams) =>
      api.getVectorProjection(kbId, { ...params, refresh: true }),
    onSuccess: (data, params) => {
      void queryClient.setQueryData(knowledgeVectorProjectionKey(kbId, params), data);
    },
  });
}
