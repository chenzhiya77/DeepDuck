import { describe, expect, it } from "@rstest/core";

import { parseDeliveryReceipt } from "@/core/delivery/parse";

/**
 * Reading the terminal delivery receipt off the run events route.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §5.
 * The load-bearing rule is "a verdict or nothing": the base record carries no
 * verdict at all (most runs), and the three render branches are total only if a
 * half-written verdict is refused rather than shown with holes in it.
 */
const VERDICT = {
  verification: {
    source: "outputs_changed",
    requirement: "present_files_matches_produced_output",
  },
  produced_paths: ["/mnt/user-data/outputs/report.md"],
  presented_paths: ["/mnt/user-data/outputs/report.md"],
  matched_paths: ["/mnt/user-data/outputs/report.md"],
  stage: "presented",
  satisfied: true,
};

const BASE = {
  presented: 1,
  paths: ["/out/a.md"],
  by_tool: { present_files: ["/out/a.md"] },
};

const rowWith = (content: unknown) => ({
  event_type: "run.delivery",
  content,
  seq: 1,
});

describe("parseDeliveryReceipt", () => {
  it("returns null when the run has no receipt", () => {
    expect(parseDeliveryReceipt([])).toBeNull();
    expect(
      parseDeliveryReceipt([{ event_type: "run.start", content: {} }]),
    ).toBeNull();
    expect(parseDeliveryReceipt([rowWith("oops")])).toBeNull();
    expect(parseDeliveryReceipt([rowWith(null)])).toBeNull();
  });

  it("reads the base record without inventing a verdict", () => {
    // The majority shape: a run that produced no output artifacts. Switching on
    // the event rather than the verdict would render a "handed over 0" line on
    // almost every run.
    expect(
      parseDeliveryReceipt([rowWith({ presented: 0, paths: [], by_tool: {} })]),
    ).toEqual({
      presented: 0,
      paths: [],
      by_tool: {},
      verdict: null,
    });
  });

  it("keeps the handed-over facts alongside the verdict", () => {
    const receipt = parseDeliveryReceipt([rowWith({ ...BASE, ...VERDICT })]);

    expect(receipt?.presented).toBe(1);
    expect(receipt?.by_tool).toEqual({ present_files: ["/out/a.md"] });
    expect(receipt?.verdict?.stage).toBe("presented");
  });

  it.each([
    ["presented", true],
    ["mismatched", false],
    ["not_started", false],
  ])("reads the %s verdict", (stage, satisfied) => {
    const receipt = parseDeliveryReceipt([
      rowWith({ ...BASE, ...VERDICT, stage, satisfied }),
    ]);

    expect(receipt?.verdict?.stage).toBe(stage);
    expect(receipt?.verdict?.satisfied).toBe(satisfied);
    expect(receipt?.verdict?.produced_paths).toHaveLength(1);
    expect(receipt?.verdict?.matched_paths).toHaveLength(1);
    expect(receipt?.verdict?.verification?.requirement).toBe(
      "present_files_matches_produced_output",
    );
  });

  it.each([
    ["a missing verdict", { stage: "presented" }],
    ["a missing stage", { satisfied: true }],
    [
      "a missing path list",
      { stage: "presented", satisfied: true, presented_paths: [] },
    ],
    ["a stage outside the vocabulary", { ...VERDICT, stage: "invented" }],
    ["a non-boolean verdict", { ...VERDICT, satisfied: "yes" }],
  ])(
    "refuses %s rather than rendering a half-filled one",
    (_label, verdict) => {
      const receipt = parseDeliveryReceipt([rowWith({ ...BASE, ...verdict })]);

      expect(receipt).not.toBeNull();
      expect(receipt?.verdict).toBeNull();
    },
  );

  it("falls back to the path list for the handed-over count", () => {
    const receipt = parseDeliveryReceipt([
      rowWith({ paths: ["/out/a.md", "/out/b.md"], by_tool: {} }),
    ]);

    expect(receipt?.presented).toBe(2);
  });

  it("takes the first receipt when the route returns more than one row", () => {
    const receipt = parseDeliveryReceipt([
      rowWith({ ...BASE, ...VERDICT, stage: "mismatched", satisfied: false }),
      rowWith({ ...BASE, ...VERDICT }),
    ]);

    expect(receipt?.verdict?.stage).toBe("mismatched");
  });
});
