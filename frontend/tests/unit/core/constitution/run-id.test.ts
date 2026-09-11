import { describe, expect, it } from "@rstest/core";

import { resolveRunId } from "@/core/constitution/run-id";

/**
 * Which run the constitution view describes.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.1
 */
const msg = (run_id?: string | null) =>
  ({ run_id }) as { run_id?: string | null };

describe("resolveRunId", () => {
  it("prefers the live run id", () => {
    expect(resolveRunId("live-run", [msg("history-run")])).toBe("live-run");
  });

  it("falls back to the newest run id in the visible messages", () => {
    expect(resolveRunId(null, [msg("older"), msg("newer")])).toBe("newer");
  });

  it("skips messages without a run id while scanning backwards", () => {
    expect(resolveRunId(null, [msg("older"), msg(undefined), msg(null)])).toBe(
      "older",
    );
  });

  it("returns null for an empty thread or a blank live id", () => {
    expect(resolveRunId(null, [])).toBeNull();
    expect(resolveRunId("", [])).toBeNull();
    expect(resolveRunId(undefined, [msg(undefined)])).toBeNull();
  });
});
