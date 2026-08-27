/**
 * Pure derivations over the eval runs payload (spec 2026-08-27 §5.3). The
 * polling cadence lives here — like wiki-status.ts — so the hook wiring stays
 * trivially testable.
 */
import type { EvalRunListResponse } from "./types";

/**
 * Polling cadence for the eval runs history while an on-demand run is in
 * flight — same 3s cadence as the documents and wiki queries; idle history
 * never polls.
 */
export const EVAL_RUNS_POLL_INTERVAL_MS = 3000;

/**
 * TanStack Query ``refetchInterval`` decision for the eval runs history:
 * poll only while the top-level ``in_flight`` flag reports a run in flight.
 * An undefined payload means the query is disabled or not yet fetched.
 */
export function evalRunsRefetchInterval(data: EvalRunListResponse | undefined): number | false {
  if (!data) return false;
  return data.in_flight ? EVAL_RUNS_POLL_INTERVAL_MS : false;
}

/**
 * True while the eval toolbar should render 运行中… — the pending flag covers
 * the click→first-poll gap (the 202 ack returns before the next poll sees the
 * top-level flag flip, wiki `isWikiUpdating` same-shape precedent).
 */
export function isEvalRunning(data: EvalRunListResponse | undefined, mutationPending: boolean): boolean {
  return mutationPending || (data?.in_flight ?? false);
}
