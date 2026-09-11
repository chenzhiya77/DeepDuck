/**
 * Wire shapes for the run-scoped harness constitution view.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.
 * Field names mirror the payload the backend publishes (§6.5 of the constitution
 * spec) — they are the contract, so they are not renamed on this side.
 */

/** The six gate tags, in the catalog's order. */
export const GATE_TAGS = [
  "read_gate",
  "tool_progress",
  "subagent_limit",
  "tool_promotion",
  "sandbox_audit",
  "skill_policy",
] as const;

export type GateTag = (typeof GATE_TAGS)[number];

export interface ConstitutionStage {
  key: string;
  loop: boolean;
  members: number;
  gates: number;
  handoff_gates: number;
}

export interface ConstitutionMiddleware {
  name: string;
  stage: string;
  kind: string;
  hooks: string[];
  frequency: string;
  overlay_kind?: string;
  exits_run?: boolean;
}

export interface ConstitutionTool {
  name: string;
  source: string;
  group: string | null;
}

export interface ConstitutionTools {
  mounted: ConstitutionTool[];
  mounted_count: number;
  deferred_names: string[];
  deferred_count: number;
  auto_promote_top_k: number;
  truncated: boolean;
}

export interface ConstitutionSkills {
  available_count: number;
  deferred_discovery: boolean;
  describe_skill_bound: boolean;
}

export interface ConstitutionModel {
  name: string | null;
  thinking_enabled: boolean;
  reasoning_effort: string | null;
}

export interface ConstitutionAgent {
  name: string | null;
  is_bootstrap: boolean;
}

export interface ConstitutionRecord {
  schema_version: number;
  model: ConstitutionModel;
  agent: ConstitutionAgent;
  checkpoint_mode: string | null;
  runtime_flags: Record<string, unknown>;
  stages: ConstitutionStage[];
  middlewares: ConstitutionMiddleware[];
  tools: ConstitutionTools;
  tool_authorization: { removed: string[]; removed_count: number };
  skills: ConstitutionSkills;
  mcp_routing_built: boolean;
  /** Raised when either the record or its tool catalogue was cut down to fit. */
  truncated: boolean;
}

/** One gate decision, normalized from whichever leg it arrived on. */
export interface GateNotification {
  tag: GateTag;
  name: string;
  hook: string;
  action: string;
  changes: Record<string, unknown>;
  /** Present on the persisted leg only. */
  seq?: number;
}

/** A row from `GET /runs/{run_id}/events`, narrowed to what these readers use. */
export interface RunEventRow {
  event_type: string;
  content?: unknown;
  seq?: number;
}
