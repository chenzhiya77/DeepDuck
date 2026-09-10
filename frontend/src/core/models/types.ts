export interface Model {
  id: string;
  name: string;
  model: string;
  display_name: string;
  description?: string | null;
  supports_thinking?: boolean;
  supports_reasoning_effort?: boolean;
  /** Declared effort subset; null/undefined = undeclared (all four levels apply). */
  supported_reasoning_efforts?: ReasoningEffortLevel[] | null;
  /** Default effort level; NULL/undefined = none declared. */
  reasoning_effort?: ReasoningEffortLevel | null;
  /** Total context window in tokens; null/undefined when unconfigured. */
  context_window?: number | null;
}

export interface TokenUsageSettings {
  enabled: boolean;
}

export interface ModelsResponse {
  models: Model[];
  token_usage: TokenUsageSettings;
}

// ── Admin models management (spec 2026-09-10 §5.5) ────────────────────────

/** Curated provider ids the backend allowlists (maps to a fixed `use:` path). */
export type ProviderId = "openai-compatible" | "anthropic" | "deepseek";

/** Reasoning-effort levels, in enum order; mirrors the backend `REASONING_EFFORT_LEVELS`. */
export type ReasoningEffortLevel = "minimal" | "low" | "medium" | "high";

export type ModelSource = "config_file" | "ui";

/** Admin view of one model returned by `GET /api/models/config`. */
export interface ManagedModel {
  name: string;
  model: string;
  display_name?: string | null;
  description?: string | null;
  /** Allowlisted provider id; null/undefined when the stored `use:` is custom. */
  provider?: ProviderId | string | null;
  /** Canonical endpoint field name (`base_url` / `api_base`). */
  endpoint_key?: string | null;
  endpoint?: string | null;
  /** Always the masking sentinel from the server; never a real key. */
  api_key: string;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_reasoning_effort?: boolean;
  /** Declared window subset (ascending); null/undefined = never declared. */
  supported_context_windows?: number[] | null;
  /** Declared effort subset (enum order); null/undefined = never declared. */
  supported_reasoning_efforts?: ReasoningEffortLevel[] | null;
  /** Default effort level; the backend requires it to be a member of the subset. */
  reasoning_effort?: ReasoningEffortLevel | null;
  context_window?: number | null;
  source: ModelSource;
  editable: boolean;
}

export interface ModelsConfigResponse {
  models: ManagedModel[];
}

/** One UI-managed model submitted to `PUT /api/models/config`. */
export interface ManagedModelInput {
  provider: ProviderId;
  name: string;
  model: string;
  api_key?: string;
  endpoint?: string;
  display_name?: string;
  description?: string;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_reasoning_effort?: boolean;
  supported_context_windows?: number[];
  supported_reasoning_efforts?: ReasoningEffortLevel[];
  reasoning_effort?: ReasoningEffortLevel;
  context_window?: number;
  max_tokens?: number;
  use_responses_api?: boolean;
}

/** Body of `POST /api/models/config/validate` (spec §5.3.2). */
export interface ValidateModelsConfigInput {
  provider: ProviderId;
  /** Provider base URL; the server appends its own model-list path. */
  endpoint: string;
  /** Probe-only credential: used for this call and never persisted. */
  api_key: string;
  model: string;
}

/** Outcome of the probe; `detail` is server-authored and never contains the key. */
export interface ValidateModelsConfigResult {
  ok: boolean;
  model_present: boolean;
  detail: string;
}
