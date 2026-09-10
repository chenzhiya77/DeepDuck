export interface Model {
  id: string;
  name: string;
  model: string;
  display_name: string;
  description?: string | null;
  supports_thinking?: boolean;
  supports_reasoning_effort?: boolean;
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
  context_window?: number;
  max_tokens?: number;
  use_responses_api?: boolean;
}
