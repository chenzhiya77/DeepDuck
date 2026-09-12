import { describe, expect, it } from "@rstest/core";

import { describeStartFailure } from "@/core/run-status/start-failure";

/**
 * Reading the failure off the error the stream handler caught.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.2. The shape this parses is the SDK's `HTTPError`, which reaches `onError`
 * only — `thread.submit` never rejects, because the SDK's stream manager routes
 * the failure to that callback instead (`ui/manager.js`). `HTTPError extends
 * Error` and carries `status` / `text`, and `status` is the only field consulted.
 */
const httpError = (status: number, text = ""): Error =>
  Object.assign(new Error(`HTTP ${status}: ${text}`), { status, text });

describe("describeStartFailure", () => {
  it("reads an occupied thread as occupied, with the stop action", () => {
    expect(describeStartFailure(httpError(409))).toEqual({
      kind: "occupied",
      action: "stop",
    });
  });

  it("reads a rejected model as a configuration problem", () => {
    expect(describeStartFailure(httpError(400))).toEqual({
      kind: "config",
      action: "configure",
    });
  });

  it("reads a missing thread as an environment problem", () => {
    expect(describeStartFailure(httpError(404))).toEqual({
      kind: "environment",
      action: "backToList",
    });
  });

  it("gives a checkpoint mode mismatch its own kind, not a gone thread", () => {
    expect(describeStartFailure(httpError(503))).toEqual({
      kind: "modeMismatch",
      action: "restart",
    });
  });

  it("shows nothing for the two frontend-bug statuses", () => {
    expect(describeStartFailure(httpError(422))).toEqual({
      kind: "none",
      action: null,
    });
    expect(describeStartFailure(httpError(501))).toEqual({
      kind: "none",
      action: null,
    });
  });

  it("shows nothing when the error carries no status", () => {
    // A transport failure mid-stream, a local throw, an upload rejection — none
    // of them is a run that failed to start, so none of them gets a sentence.
    expect(describeStartFailure(new Error("boom"))).toEqual({
      kind: "none",
      action: null,
    });
    expect(describeStartFailure(null)).toEqual({ kind: "none", action: null });
    expect(describeStartFailure(undefined)).toEqual({
      kind: "none",
      action: null,
    });
    expect(describeStartFailure("oops")).toEqual({
      kind: "none",
      action: null,
    });
  });

  it("does not read a status of the wrong shape", () => {
    expect(describeStartFailure({ status: "409" })).toEqual({
      kind: "none",
      action: null,
    });
    expect(describeStartFailure({ status: null })).toEqual({
      kind: "none",
      action: null,
    });
  });
});
