/**
 * Wire + verdict shapes for a run's terminal outcome.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §4.
 * Field names mirror `RunResponse`, so they are not renamed on this side — the
 * same rule the constitution and delivery modules follow.
 */

/**
 * The run's outcome, projected to the three fields this line reads.
 *
 * `status` is the authoritative terminal state (`RunRow.status`); `run.end`
 * always writes `success` and is deliberately not consulted. It stays a plain
 * `string` rather than a union so an unrecognized value classifies to `none`
 * instead of failing to type-check — a reader must never be shown a guess.
 */
export interface RunOutcome {
  status: string;
  stop_reason: string | null;
  error: string | null;
}

/**
 * What the reader is looking at, once classified.
 *
 * `none` is a real answer rather than "no answer": a `success`, a run with no
 * terminal state yet, and the two frontend-bug statuses (422 / 501) all land
 * here and render nothing at all.
 */
export const FAILURE_KINDS = [
  "occupied",
  "config",
  "environment",
  "modeMismatch",
  "runFailed",
  "stopped",
  "none",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

/**
 * The kinds that reach the UI — the table's `none` row removed.
 *
 * `run-status-i18n-keys.json` mirrors this list and a backend guard asserts the
 * two agree, so a new kind cannot ship without copy to render.
 */
export const PRESENTED_KINDS = [
  "occupied",
  "config",
  "environment",
  "modeMismatch",
  "runFailed",
  "stopped",
] as const satisfies readonly FailureKind[];

/** What the reader can do, as a key: the copy carries the sentence. */
export const FAILURE_ACTIONS = [
  "stop",
  "configure",
  "backToList",
  "restart",
  "inspect",
] as const;

export type FailureAction = (typeof FAILURE_ACTIONS)[number];

/** The verdict: which kind, and what to offer alongside it. */
export interface RunOutcomeVerdict {
  kind: FailureKind;
  action: FailureAction | null;
}

/** The verdict plus the raw projection the details line reads. */
export interface RunOutcomeView extends RunOutcomeVerdict {
  outcome: RunOutcome;
}
