/**
 * Wire contracts for the admin RAG functional-model configuration
 * (spec 2026-09-10 rag functional-model config §5).
 *
 * Mirrors the backend `RagConfigFile`: every field is optional, `None`/absent means "not
 * declared here", and secrets arrive masked (or empty when the environment backs them).
 */

/** Video-ingestion model choices the settings UI may override. */
export interface RagVideoValues {
  asr_provider?: "funasr" | "whisper" | null;
  asr_model?: string | null;
  caption_model?: string | null;
}

/** One effective RAG configuration object (the PUT body, and the GET's `config`). */
export interface RagConfigValues {
  qdrant_url?: string | null;
  embedding_model?: string | null;
  embedding_api_key?: string | null;
  rerank_model?: string | null;
  rerank_api_key?: string | null;
  vlm_model?: string | null;
  vlm_base_url?: string | null;
  vlm_api_key?: string | null;
  extract_model?: string | null;
  judge_model?: string | null;
  mineru_api_token?: string | null;
  /**
   * Provider dimension (spec 2026-09-14 §4.1). Ids mirror the backend's curated
   * allowlist: a value outside it is rejected by the server, not silently accepted.
   */
  embedding_provider?: "dashscope" | "openai-compatible" | null;
  embedding_base_url?: string | null;
  embedding_dimension?: number | null;
  embedding_sparse_source?: "provider" | "external" | "bm25" | null;
  sparse_provider?: "tei-sparse" | null;
  sparse_base_url?: string | null;
  sparse_model?: string | null;
  sparse_api_key?: string | null;
  rerank_provider?: "dashscope" | "generic-rerank" | null;
  rerank_base_url?: string | null;
  parse_provider?: "mineru-cloud" | "mineru-local" | null;
  parse_base_url?: string | null;
  parse_backend?: "vlm" | "hybrid" | null;
  video?: RagVideoValues | null;
}

/**
 * Where a value comes from. Non-secret fields report `ui` (declared in
 * `rag_config.json`) or `config_file`; secret fields report `ui`, `env` (no stored
 * value but the backing variable is set) or `unset`. Only existence is reported for
 * secrets — never a value.
 */
export type RagConfigSource = "ui" | "config_file" | "env" | "unset";

/** GET/PUT response: the effective values plus the flattened per-field origin map. */
export interface RagConfigView {
  config: RagConfigValues;
  sources: Record<string, RagConfigSource>;
}

/** PUT body: the whole object, standing in for the new file content. */
export type RagConfigInput = RagConfigValues;
