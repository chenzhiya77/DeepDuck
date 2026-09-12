/**
 * Wire shapes for the run-scoped delivery receipt.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §5.
 * Field names mirror the payload the backend publishes (and the contract now
 * declares), so they are not renamed on this side — same rule the constitution
 * module follows.
 */

/** The verdict's three states; the contract's `stage` enum verbatim. */
export const DELIVERY_STAGES = [
  "presented",
  "mismatched",
  "not_started",
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export interface DeliveryVerification {
  source: string | null;
  requirement: string | null;
}

/**
 * The verdict, present only when the run **produced** output artifacts.
 *
 * `satisfied` means *at least one* produced output was handed over, so
 * `matched_paths` may be shorter than `produced_paths` — `presented` is not a
 * claim that everything was handed over.
 */
export interface DeliveryVerdict {
  stage: DeliveryStage;
  satisfied: boolean;
  verification: DeliveryVerification | null;
  produced_paths: string[];
  presented_paths: string[];
  matched_paths: string[];
}

export interface DeliveryReceipt {
  /** How many paths `present_files` handed over. */
  presented: number;
  paths: string[];
  by_tool: Record<string, string[]>;
  /** null on the base record — the majority shape, and carries no verdict. */
  verdict: DeliveryVerdict | null;
}

/**
 * A row from `GET /runs/{run_id}/events`.
 *
 * Defined here rather than imported from the constitution module: they are
 * sibling features and neither should depend on the other. If a third consumer
 * appears this belongs in a shared module, not a second copy.
 */
export interface RunEventRow {
  event_type: string;
  content?: unknown;
  seq?: number;
}
