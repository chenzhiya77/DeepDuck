import type { RunOutcome } from "./types";

/**
 * Reading the run's outcome off `GET /threads/{id}/runs/{rid}`.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §4.3.
 * Rebuilt field by field rather than spread, so a field a newer response adds
 * cannot leak into a shape the notice never agreed to render — the same rule
 * `core/constitution/parse.ts` and `core/delivery/parse.ts` follow.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asReason(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The run's outcome, or null when the row carries no usable status.
 *
 * A row without a status cannot be classified, and rendering it as if the run had
 * ended would print an outcome nobody reported — callers treat null as "nothing
 * to say". A reason of the wrong shape is dropped the same way, so an absent
 * reason stays absent instead of becoming an invented empty one.
 */
export function parseRunOutcome(row: unknown): RunOutcome | null {
  if (!isRecord(row)) {
    return null;
  }
  const status = row.status;
  if (typeof status !== "string" || status === "") {
    return null;
  }
  return {
    status,
    stop_reason: asReason(row.stop_reason),
    error: asReason(row.error),
  };
}
