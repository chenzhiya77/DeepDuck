import { describe, expect, it } from "@rstest/core";

import {
  classifyRunOutcome,
  classifyStartFailure,
} from "@/core/run-status/classify";

/**
 * The one place this line judges, and it is deliberately dumb.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.2. Two entries because the two directions genuinely differ: a run that never
 * started is classified off the HTTP status the caller caught, a run that ended
 * is classified off the status the row carries.
 *
 * The rule every unrecognized input obeys: **do not guess.** An unknown code or
 * status renders nothing instead of taking the nearest sentence.
 */
describe("classifyStartFailure", () => {
  it("reads an occupied thread as occupied, with the stop action", () => {
    expect(classifyStartFailure(409)).toEqual({
      kind: "occupied",
      action: "stop",
    });
  });

  it("reads a rejected model as a configuration problem", () => {
    expect(classifyStartFailure(400)).toEqual({
      kind: "config",
      action: "configure",
    });
  });

  it("reads a missing thread as an environment problem", () => {
    expect(classifyStartFailure(404)).toEqual({
      kind: "environment",
      action: "backToList",
    });
  });

  it("gives a checkpoint mode mismatch its own kind, not a gone thread", () => {
    // Borrowing the gone-thread sentence would tell the reader their chat no
    // longer exists and send them off to re-open it, while the real remedy is
    // restarting the service with the matching mode — the action would fail.
    expect(classifyStartFailure(503)).toEqual({
      kind: "modeMismatch",
      action: "restart",
    });
  });

  it("shows nothing for the two frontend-bug statuses", () => {
    // 422 is a malformed request body and 501 an unimplemented SDK option: both
    // are our bug, neither has anything the reader can act on.
    expect(classifyStartFailure(422)).toEqual({ kind: "none", action: null });
    expect(classifyStartFailure(501)).toEqual({ kind: "none", action: null });
  });

  it("shows nothing for a status it does not know", () => {
    for (const status of [500, 418, 0, undefined, null] as const) {
      expect(classifyStartFailure(status)).toEqual({
        kind: "none",
        action: null,
      });
    }
  });
});

describe("classifyRunOutcome", () => {
  const outcome = (status: string) => ({
    status,
    stop_reason: null,
    error: null,
  });

  it("reads a failed run as a run failure, with the inspect action", () => {
    expect(classifyRunOutcome(outcome("error"))).toEqual({
      kind: "runFailed",
      action: "inspect",
    });
    expect(classifyRunOutcome(outcome("timeout"))).toEqual({
      kind: "runFailed",
      action: "inspect",
    });
  });

  it("reads an interrupted run as stopped, with no action to take", () => {
    // Only the user stops a run in this app (a second submission collides on
    // 409 rather than interrupting), so there is nothing to offer them.
    expect(classifyRunOutcome(outcome("interrupted"))).toEqual({
      kind: "stopped",
      action: null,
    });
  });

  it("shows nothing for a run that succeeded", () => {
    expect(classifyRunOutcome(outcome("success"))).toEqual({
      kind: "none",
      action: null,
    });
  });

  it("shows nothing while the run has no terminal state yet", () => {
    expect(classifyRunOutcome(outcome("running"))).toEqual({
      kind: "none",
      action: null,
    });
    expect(classifyRunOutcome(outcome("pending"))).toEqual({
      kind: "none",
      action: null,
    });
  });

  it("shows nothing for a status it does not know, or for no outcome at all", () => {
    expect(classifyRunOutcome(outcome("something_new"))).toEqual({
      kind: "none",
      action: null,
    });
    expect(classifyRunOutcome(null)).toEqual({ kind: "none", action: null });
    expect(classifyRunOutcome(undefined)).toEqual({
      kind: "none",
      action: null,
    });
  });
});
