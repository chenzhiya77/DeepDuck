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
  /** "enqueued" | "already_running" (P1 触发幂等, 2026-08-14: a run is in flight). */
  status: "enqueued" | "already_running" | string;
}

/** Wiki tab list item (phase-2 batch-1): summary-only, no full content. */
export interface WikiEntrySummary {
  id: string;
  title: string;
  summary: string;
  status: "ready" | "dirty" | string;
  updated_at: string;
}

/**
 * Library-level wiki generation run state (wiki 更新状态可见, 2026-08-14).
 * Same source as ``path_status.wiki === "generating"``, exposed on the
 * entries payload so the wiki tab can render 更新中 and poll until done.
 */
export type WikiGenerationState = "idle" | "generating" | string;

/** Wiki entries list payload: summaries + the library-level run flag. */
export interface WikiEntriesPage {
  entries: WikiEntrySummary[];
  generation: WikiGenerationState;
  /**
   * Terminal status of the most recent run (P1 失败可见性, 2026-08-14) —
   * the completion toast keys off it so a crashed run never surfaces as
   * 已更新. ``null`` = never ran in this process.
   */
  last_run: "succeeded" | "failed" | null;
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

// ── Phase-3 Batch-1 P6: manual knowledge cards (spec §8) ──────────────────
// Fully user-managed entries outside the AI wiki lifecycle: never
// auto-regenerated, never disqualified. ``include_in_wiki_search`` opts the
// card into the wiki retrieval path's shared top_k pool (Task 8).

/** Manual card list item: summary-only, no full content (wiki-list pattern). */
export interface ManualCardSummary {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  include_in_wiki_search: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManualCardsPage {
  items: ManualCardSummary[];
  total: number;
  offset: number;
  limit: number;
}

/** Full manual card, fetched on demand for the editor. */
export interface ManualCardDetail {
  id: string;
  kb_id: string;
  owner_id: string;
  title: string;
  content: string;
  tags: string[];
  include_in_wiki_search: boolean;
  created_at: string;
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
   * Phase-2 batch-1: filled by the frontend parse layer from the tool name
   * (wiki_search → "wiki", hybrid/graph → "chunk"). Phase-3 P6 (spec §8):
   * wiki_search mixes manual cards into its entries, so a payload-level
   * ``source_type`` wins when present ("manual" for cards). Undefined on
   * legacy citations — render those as "chunk".
   */
  source_type?: "chunk" | "wiki" | "manual";
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
  /**
   * Phase-3 P6（spec §8 混排）：wiki 路命中可能是人工卡片。前端据此分流
   * 「条目抽屉 / 卡片抽屉」——卡片 id 走 wiki 详情接口必然 404。缺省回退
   * "wiki"（旧响应形态）。
   */
  source_type?: "wiki" | "manual";
  /**
   * 词条的源切片锚定（2026-08-28 spec §5，Task 5 后端）：仅词条携带，人工卡片
   * （source_type === "manual"）无此键——百科路勾选存题时据此进锚定集。
   */
  source_chunk_ids?: string[];
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

// ── 向量空间可视化（2026-08-15 spec §7：四 collection 同图投影）────────────

/** Point provenance — one per Qdrant collection (spec §3 双编码着色的大类维度). */
export type VectorSourceType = "chunk" | "entity" | "wiki" | "card";

/** Reducer choice; umap requires the optional server-side extra (spec §4). */
export type VectorProjectionAlgo = "pca" | "umap";

/**
 * One projected point. ``z`` only appears for dims=3; ``preview`` is the
 * chunk hover text joined from the business DB (never rides the Qdrant
 * payload); ``heading_path`` / ``doc_name`` accompany chunk points.
 */
export interface VectorProjectionPoint {
  id: string;
  source_type: VectorSourceType | string;
  x: number;
  y: number;
  z?: number;
  label: string;
  /** Coloring rule: doc_id for chunks, entity type for entities, source_type otherwise. */
  color_key: string;
  preview?: string;
  doc_name?: string;
  heading_path?: string[];
}

/** GET /vector-projection — fingerprint-cached projection of the four collections. */
export interface VectorProjectionResponse {
  kb_id: string;
  algo: VectorProjectionAlgo | string;
  dims: 2 | 3;
  model_version: string;
  /** Content digest driving the server-side cache (spec §6). */
  fingerprint: string;
  cached: boolean;
  computed_ms: number;
  total_points: number;
  shown_points: number;
  /** true when chunks were subsampled (only chunks ever are, spec §5). */
  sampled: boolean;
  points: VectorProjectionPoint[];
}

/** POST /vector-projection/query — query text transformed into the cached PCA space. */
export interface VectorProjectionQueryResult {
  x: number;
  y: number;
  z?: number;
  model_version: string;
  /** Matches the projection it was transformed with — staleness check for overlays. */
  fingerprint: string;
}

// ── P6 检索联动叠加（2026-08-15 spec §9 双通道共享）──────────────────────

/**
 * 一个叠加命中点。pointId 即投影点 id：chunk 切片 = chunk_id，wiki = entry_id，
 * card = card_id（citations 解析层把后两者的 id 也填在 chunk_id 字段，天然对齐）。
 */
export interface VectorOverlayHit {
  pointId: string;
  /** null = 该路降级无分（reranker 退化的 RRF 序），色深取中间档。 */
  score: number | null;
}

/**
 * page 层共享的检索叠加请求：recall「在向量空间查看」（显式跳转）与 chat 每轮
 * 自动跟随共用同一形态。text 经 POST /vector-projection/query 投影为落点；
 * hits 驱动命中高亮 / 连线 / score 色深。
 */
export interface VectorRetrievalOverlay {
  source: "recall" | "chat";
  text: string;
  hits: VectorOverlayHit[];
}

// ── 知识图谱可视化（2026-08-19 spec §4 P1）─────────────────────────────

/** GET /graph 的节点：实体名即 id；mention_count = len(source_chunk_ids)。 */
export interface KnowledgeGraphNode {
  id: string;
  type: string;
  description: string;
  mention_count: number;
  /** Louvain 社区 id（0 = 最大社区，规模降序，固定种子保证稳定）。 */
  community: number;
  /** 提及该实体的切片 id（`{doc_id}#%04d`）——实体钻取链路的跳转数据。 */
  source_chunk_ids: string[];
}

/** GET /graph 的边：关系有向（source → target）。 */
export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: string;
  description: string;
}

/** GET /graph 响应的社区汇总项（2026-08-21 Task 7b LOD：SuperNode 聚合数据源）。 */
export interface KnowledgeGraphCommunity {
  id: number;
  memberCount: number;
  totalMentions: number;
  /** 社区内 mention 降序 Top 3（同数按名字典序）。 */
  topMembers: Array<{ id: string; mention_count: number }>;
  /** 主导类型：社区内 mention 总和最高的 type（同数按名字典序）。 */
  dominantType: string;
}

export interface KnowledgeGraphResponse {
  kb_id: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: { node_count: number; edge_count: number; community_count: number };
  /** Task 7b：社区级汇总（LOD 分层渲染的 cluster/hub 层数据源）。 */
  communities: KnowledgeGraphCommunity[];
}

// ── P4 graph_search 路径高亮（2026-08-19 spec §7）───────────────────────────

/** graph_search 工具响应透传的检索轨迹（后端 snake_case 原样镜像，零映射成本）。 */
export interface GraphRetrievalTrace {
  /** 种子实体：查询向量命中的 hop-0 实体名。 */
  seed_entities: string[];
  /** 扩展节点：hop ≥ 1 的邻域扩展（hop 信息驱动橙/黄分层染色）。 */
  expanded_nodes: { name: string; hop: number }[];
  /** 证据实体：被选中切片的实体/边来源端点。 */
  evidence_entities: string[];
}

/**
 * page 层共享的图谱叠加请求（对齐 VectorRetrievalOverlay 先例）：chat 每轮
 * 完成含 graph_search 轨迹的对话后上报；图谱 tab 的「跟随对话」开关决定何时
 * 应用（冻结语义在 GraphTab 内）。
 */
export interface GraphRetrievalOverlay {
  source: "chat";
  /** 该轮的可见用户提问文本（徽标展示用）。 */
  text: string;
  trace: GraphRetrievalTrace;
}

// ── Evaluation metrics (spec 2026-08-24 §3.2, plan Task 2) ────────────────

/** Layer 1 per-category metrics（wire format 平铺结构：{summary, fact?, relation?, concept?, global?}）。*/
export type Layer1CategoryKey = "fact" | "relation" | "concept" | "global";

export interface Layer1CategoryMetrics {
  hit_rate: number;
  recall_at_k: number;
  mrr: number;
  path_accuracy: number;
  question_count: number;
}

/** Layer 1 summary + dynamic category keys from the dataset schema. */
export interface Layer1Metrics {
  summary: Layer1CategoryMetrics;
  fact?: Layer1CategoryMetrics;
  relation?: Layer1CategoryMetrics;
  concept?: Layer1CategoryMetrics;
  global?: Layer1CategoryMetrics;
}

/** RAGAS standard metrics (RagasReport.aggregate.ragas). */
export interface RagasMetrics {
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  context_recall: number | null;
}

/** Architecture-specific metrics (RagasReport.arch_specific). */
export interface ArchSpecificMetrics {
  citation_precision: number | null;
  citation_recall: number | null;
  seed_hit_rate: number | null;
}

/** Baseline comparison diff (wire payload includes per-category gate results). */
export interface BaselineDiff {
  recall_at_k_delta: number | null;
  regression_detected: boolean;
  threshold_percent: number;
  regressed_categories?: string[];
}

/** MetricsOverview payload for GET /eval-runs/latest (spec §3.2). */
export interface MetricsOverview {
  kb_id: string;
  layer1: {
    run_id: string;
    created_at: string;
    metrics: Layer1Metrics;
    baseline_diff?: BaselineDiff;
  } | null;
  layer2: {
    run_id: string;
    created_at: string;
    ragas_available: boolean;
    ragas_skip_reason?: string;
    ragas: RagasMetrics;
    arch_specific: ArchSpecificMetrics;
    langfuse_trace_url?: string;
    has_graph_questions: boolean;
  } | null;
}

// ── Evaluation trend (spec 2026-08-24 §4.1, plan Task 3) ─────────────────

/**
 * 趋势图单个数据点：两层指标独立取数，各自可空。
 * 每个点恒等于一次真实运行（统一「周期末次」聚合语义，spec §4.2）。
 */
export interface TrendPoint {
  /** ISO8601 日期（聚合粒度决定精度）。 */
  date: string;
  /** Layer 1（该层该周期无数据则 null）。 */
  recall_at_k: number | null;
  hit_rate: number | null;
  mrr: number | null;
  /** Layer 2 RAGAS（同粒度，独立取数）。 */
  faithfulness: number | null;
  answer_relevancy: number | null;
  context_precision: number | null;
  /** 下钻来源行：Layer 1 线挂 layer1_run_id，Layer 2 线挂 layer2_run_id。 */
  layer1_run_id: string | null;
  layer2_run_id: string | null;
  /** 该点 Layer 1 来源运行的门禁判定（透传其 baseline_diff）；无 diff 为 null。 */
  regression: { detected: boolean; categories: string[] } | null;
  /** 该点对应 Layer 1 运行是否被 --mark-baseline 标记。 */
  is_baseline_update: boolean;
}

/** 趋势图 API 响应（GET /eval-runs/trend）。 */
export interface TrendResponse {
  points: TrendPoint[];
  granularity: "day" | "week" | "month";
  /** 窗口回显：只含当前粒度匹配的键（day→days_back / week→weeks_back / month→months_back）。 */
  days_back?: number;
  weeks_back?: number;
  months_back?: number;
  /** 当前 baseline；无 baseline 行时为 null（前端不画阈值线）。 */
  baseline: {
    recall_at_k: number;
    /** DEFAULT_FAIL_THRESHOLD * 100，与 CI 门禁同源。 */
    threshold_percent: number;
  } | null;
  /** 该时间范围内是否有数据（任一层有即为 true）。 */
  has_data: boolean;
}

/** 趋势图请求参数（窗口参数按粒度配对，spec §4.2）。 */
export interface TrendQueryParams {
  granularity: "day" | "week" | "month";
  /** day 粒度用，默认 30（后端 clamp ≤90）。 */
  days_back?: number;
  /** week 粒度用，默认 12。 */
  weeks_back?: number;
  /** month 粒度用，默认 6。 */
  months_back?: number;
}

/**
 * 趋势图 i18n 文案包（canvas 组件纯渲染不调 useI18n——文案经 props 注入，
 * spec §3.6）。eval-tab 从 tk.eval.* 组装。
 */
export interface TrendChartLabels {
  /** 6 条指标线的显示名（图例 + tooltip）。 */
  recallAtK: string;
  hitRate: string;
  mrr: string;
  faithfulness: string;
  answerRelevancy: string;
  contextPrecision: string;
  /** 阈值线名（markLine series 名）。 */
  thresholdLine: string;
  /** 阈值线标签（markLine formatter，含阈值百分数）。 */
  thresholdLabel: (thresholdPercent: number) => string;
  /** 基线更新竖线标签。 */
  baselineUpdate: string;
  /** tooltip 底部点击提示。 */
  clickForDetail: string;
  /** tooltip 中回退 category 列表前缀。 */
  regressionPrefix: string;
}

/** 单次运行详情（GET /eval-runs/{run_id}，drawer 数据源）。 */
export interface EvalRunDetail {
  run_id: string;
  kb_id: string;
  status: "completed" | "error" | "skipped";
  environment: "local" | "ci" | "nightly";
  created_at: string;
  layer1_metrics: Layer1Metrics | Record<string, never>;
  layer2_metrics: {
    ragas_available: boolean;
    ragas_skip_reason?: string;
    ragas: RagasMetrics;
    arch_specific: ArchSpecificMetrics;
    langfuse_trace_url?: string;
    has_graph_questions: boolean;
    /** Layer 2 的 path_accuracy（真实对话链路选路准确率，与 Layer 1 同名指标口径不同）。 */
    path_accuracy?: number | null;
  } | Record<string, never>;
  baseline_diff?: BaselineDiff;
  is_baseline: boolean;
}

// ── Eval question bank & run history (spec 2026-08-27 §4–§6, plan Task 4) ──

/** Golden 考题（GET / POST /eval/questions 的行对象）。 */
export interface EvalQuestion {
  /** 服务端生成（q_<hex8>），客户端不可携带。 */
  id: string;
  query: string;
  category: "fact" | "relation" | "concept" | "global";
  /** 预期路径集合（2026-08-28 spec §3，Task 4 切换）：1–3 路，任一路承担即对。 */
  expected_paths: RecallPathName[];
  /** 空数组 = 无锚定题（Layer 1 仅参与路径判定，spec §1 事实 2）。 */
  relevant_chunk_ids: string[];
  relevant_entities: string[];
  reference_answer: string | null;
}

/** POST /eval/questions 请求体：锚定字段缺省即空数组。 */
export interface EvalQuestionCreateInput {
  query: string;
  category: "fact" | "relation" | "concept" | "global";
  /** 至少一路（后端 min_length=1），最多三路。 */
  expected_paths: RecallPathName[];
  relevant_chunk_ids?: string[];
  relevant_entities?: string[];
  reference_answer?: string | null;
}

/** GET /eval/questions 响应：全量题库（50–100 题规模，无分页）。 */
export interface EvalQuestionListResponse {
  questions: EvalQuestion[];
  total: number;
}

// ── Question synthesis（2026-08-28 spec §6，Task 6–8）─────────────────────

/** 候选题（暂存行）：完整题目载荷 + 暂存元数据；采纳后换服务端 q_ id 入题库。 */
export interface SynthesisCandidate {
  candidate_id: string;
  query: string;
  category: "fact" | "relation" | "concept" | "global";
  expected_paths: RecallPathName[];
  relevant_chunk_ids: string[];
  relevant_entities: string[];
  reference_answer: string | null;
  doc_id: string;
  generated_at: string;
}

/** GET /eval/questions/synthesize：in_progress + 暂存候选 + 合成元数据。 */
export interface SynthesisStatus {
  in_progress: boolean;
  candidates: SynthesisCandidate[];
  generated_at: string | null;
  doc_id: string | null;
  dropped: number;
}

/** POST /eval/questions/synthesize 触发体：单篇文档 + 候选题数（1–10）。 */
export interface SynthesisTriggerInput {
  doc_id: string;
  count: number;
}

/** 202 应答：与评测触发同形（enqueued / already_running）。 */
export interface SynthesisTriggerResponse {
  status: "enqueued" | "already_running";
}

/** 历史列表行（轻量摘要，指标本体留在 drawer 详情里）。 */
export interface EvalRunSummary {
  run_id: string;
  created_at: string | null;
  completed_at: string | null;
  environment: "local" | "ci" | "nightly";
  status: "completed" | "error" | "skipped";
  is_baseline: boolean;
  has_layer1: boolean;
  has_layer2: boolean;
  regression_detected: boolean;
  langfuse_trace_url: string | null;
}

/** GET /eval-runs 响应（spec §6.1）：顶层 in_flight 驱动轮询与工具栏状态。 */
export interface EvalRunListResponse {
  in_flight: boolean;
  runs: EvalRunSummary[];
  /** include_ci 过滤后的全量行数（不是本页行数）。 */
  total: number;
}

/** POST /eval-runs 请求载荷（2026-09-01 B 方案）：``layers`` 缺省 ``l1``（快速档），
 * ``l1_l2`` 为完整档（单行双层指标）；``question_ids`` 选题运行，缺省全量。 */
export interface EvalTriggerInput {
  layers?: "l1" | "l1_l2";
  question_ids?: string[];
}

/** POST /eval-runs 202 响应（wiki generate 幂等同款）。 */
export interface EvalTriggerResponse {
  status: "enqueued" | "already_running";
}
