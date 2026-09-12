import { classifyStartFailure } from "./classify";
import type { RunOutcomeVerdict, StartFailureNotice } from "./types";

/**
 * Where the verdict rides on the reader's own message after a failed start, so
 * the notice has an anchor to render under. Read back with `readStartFailure`.
 */
export const START_FAILURE_KWARG = "deerflow_run_status";

/**
 * Reading a run-creation failure off the error the stream handler caught.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §4.2.
 *
 * The shape is the SDK's `HTTPError`: it extends `Error` and carries `status`
 * (plus `text`). It arrives at the stream handler's `onError` rather than
 * rejecting `thread.submit`, because the SDK's stream manager routes the failure
 * to that callback instead of propagating it — so that handler is the one place
 * every failed start shows up, whichever path submitted it.
 *
 * Only `status` is read. Matching on the message text was rejected outright, and
 * an error without a usable status is not a run that failed to start — a broken
 * stream, a local throw, a rejected upload — so it classifies to `none` and the
 * existing handling stands.
 */
export function describeStartFailure(error: unknown): RunOutcomeVerdict {
  const status =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "status")
      : undefined;
  return classifyStartFailure(typeof status === "number" ? status : null);
}

/**
 * The verdict a message carries, or null when it carries none.
 *
 * Exactly one message carries one at a time — the reader's own, kept back when
 * its run never started — and reading it is how the notice finds its anchor. No
 * parsing beyond the field lookup: the marker is written by this app onto a
 * message that never left it, so there is nothing to defend against here.
 */
export function readStartFailure(message: unknown): StartFailureNotice | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const kwargs = Reflect.get(message, "additional_kwargs");
  if (typeof kwargs !== "object" || kwargs === null) {
    return null;
  }
  const notice = Reflect.get(kwargs, START_FAILURE_KWARG) as
    | StartFailureNotice
    | null
    | undefined;
  return notice ?? null;
}
