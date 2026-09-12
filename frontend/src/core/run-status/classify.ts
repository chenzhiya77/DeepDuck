import type { RunOutcome, RunOutcomeVerdict } from "./types";

/**
 * The one place this line judges, and it is deliberately dumb: a status in, a
 * kind and an action key out. No fetch, no React, no copy.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §4.2.
 *
 * Two entries because the two directions genuinely differ. A run that never
 * started is classified off the HTTP status its creation failed with; a run that
 * ended is classified off the status its row carries. Nothing here reads free
 * text — matching on messages was rejected outright — and every unrecognized
 * input resolves to `none` rather than the nearest sentence.
 *
 * Lookups are `Map`s rather than plain objects on purpose: `status` comes off the
 * wire, and an object literal would answer `ENDED["constructor"]` with the Object
 * constructor. A verdict is not a thing a prototype key may supply.
 */

const NOTHING: RunOutcomeVerdict = { kind: "none", action: null };

/** The statuses the gateway refuses to start a run with, and what each means. */
const START_FAILURE_VERDICTS = new Map<number, RunOutcomeVerdict>([
  [409, { kind: "occupied", action: "stop" }],
  [400, { kind: "config", action: "configure" }],
  [404, { kind: "environment", action: "backToList" }],
  // Not the gone-thread kind: the remedy is restarting the service with the
  // matching checkpoint mode. Sharing that sentence would tell the reader their
  // chat no longer exists and send them to re-open it, where the action fails.
  [503, { kind: "modeMismatch", action: "restart" }],
  // Our bug rather than the reader's: a malformed request body and an
  // unimplemented SDK option have nothing to offer, so they render nothing.
  [422, NOTHING],
  [501, NOTHING],
]);

/** The terminal states a run row can carry, and what each means. */
const ENDED_VERDICTS = new Map<string, RunOutcomeVerdict>([
  ["error", { kind: "runFailed", action: "inspect" }],
  ["timeout", { kind: "runFailed", action: "inspect" }],
  // Only the user stops a run in this app — a second submission collides on 409
  // rather than interrupting — so there is nothing to ask them to do about it.
  ["interrupted", { kind: "stopped", action: null }],
  // Nothing to show: a clean run, or one with no terminal state yet.
  ["success", NOTHING],
  ["running", NOTHING],
  ["pending", NOTHING],
]);

/** Classify a run that never started, off the status its creation failed with. */
export function classifyStartFailure(
  httpStatus: number | null | undefined,
): RunOutcomeVerdict {
  if (typeof httpStatus !== "number") {
    return NOTHING;
  }
  return START_FAILURE_VERDICTS.get(httpStatus) ?? NOTHING;
}

/** Classify a run that ended, off the status its row carries. */
export function classifyRunOutcome(
  outcome: RunOutcome | null | undefined,
): RunOutcomeVerdict {
  if (!outcome) {
    return NOTHING;
  }
  return ENDED_VERDICTS.get(outcome.status) ?? NOTHING;
}
