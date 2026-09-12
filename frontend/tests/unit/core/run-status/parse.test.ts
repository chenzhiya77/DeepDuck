import { describe, expect, it } from "@rstest/core";

import { parseRunOutcome } from "@/core/run-status/parse";

/**
 * Reading the run's outcome off `GET /threads/{id}/runs/{rid}`.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.3. Rebuilt field by field rather than spread, so a field a newer response
 * adds cannot leak into a shape the notice never agreed to render.
 */
describe("parseRunOutcome", () => {
  it("reads the three fields it projects and drops the rest", () => {
    expect(
      parseRunOutcome({
        status: "error",
        stop_reason: "orphan_recovered",
        error:
          "Gateway restarted before this run reached a durable final state.",
        run_id: "run-1",
        total_tokens: 42,
      }),
    ).toEqual({
      status: "error",
      stop_reason: "orphan_recovered",
      error: "Gateway restarted before this run reached a durable final state.",
    });
  });

  it("keeps an absent reason absent rather than inventing an empty one", () => {
    expect(parseRunOutcome({ status: "success" })).toEqual({
      status: "success",
      stop_reason: null,
      error: null,
    });
  });

  it("drops a reason whose shape is wrong", () => {
    expect(
      parseRunOutcome({ status: "error", error: 42, stop_reason: ["x"] }),
    ).toEqual({
      status: "error",
      stop_reason: null,
      error: null,
    });
  });

  it("refuses a row that carries no usable status", () => {
    expect(parseRunOutcome({ error: "boom" })).toBeNull();
    expect(parseRunOutcome({ status: 3 })).toBeNull();
    expect(parseRunOutcome({ status: "" })).toBeNull();
    expect(parseRunOutcome(null)).toBeNull();
    expect(parseRunOutcome("error")).toBeNull();
  });
});
