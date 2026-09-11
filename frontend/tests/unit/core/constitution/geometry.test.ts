import { describe, expect, it } from "@rstest/core";

import {
  RING_GAP_DEG,
  RING_SPAN_DEG,
  RING_START_DEG,
  arcPath,
  polarPercent,
  ringLayout,
} from "@/core/constitution/geometry";
import type { ConstitutionStage } from "@/core/constitution/types";

/**
 * The ring's geometry, defined once so the renderer stays a pure function of it.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §5.1
 */
const stage = (
  key: string,
  overrides: Partial<ConstitutionStage> = {},
): ConstitutionStage => ({
  key,
  loop: ["context", "model", "tools"].includes(key),
  members: 2,
  gates: 0,
  handoff_gates: 0,
  ...overrides,
});

const fullRing = () =>
  ["intake", "context", "model", "tools", "epilogue"].map((key) => stage(key));

describe("ring constants", () => {
  it("divides the circle into five equal arcs with gaps between them", () => {
    expect(RING_START_DEG).toBe(-90);
    expect(RING_GAP_DEG).toBe(6);
    expect(RING_SPAN_DEG).toBe(66);
    expect(RING_SPAN_DEG * 5 + RING_GAP_DEG * 5).toBe(360);
  });
});

describe("ringLayout", () => {
  it("lays the five stages out clockwise from the top", () => {
    const { ring } = ringLayout(fullRing());

    expect(ring.map((arc) => arc.key)).toEqual([
      "intake",
      "context",
      "model",
      "tools",
      "epilogue",
    ]);
    expect(ring[0]?.startDeg).toBe(-90);
    expect(ring[0]?.endDeg).toBe(-24);
    expect(ring[0]?.centerDeg).toBe(-57);
    expect(ring[4]?.endDeg).toBe(264);
  });

  it("keeps the loop flag and the counts", () => {
    const { ring } = ringLayout([
      stage("intake"),
      stage("context", { members: 9, gates: 3 }),
      stage("model"),
      stage("tools"),
      stage("epilogue"),
    ]);

    expect(ring.map((arc) => arc.loop)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(ring[1]?.members).toBe(9);
    expect(ring[1]?.gates).toBe(3);
  });

  it("leaves the extension band and unknown keys off the ring", () => {
    const { ring, outside } = ringLayout([
      ...fullRing(),
      stage("extension", { loop: false, members: 1 }),
      stage("something_new", { loop: false, members: 2 }),
    ]);

    expect(ring).toHaveLength(5);
    expect(outside.map((entry) => entry.key)).toEqual([
      "extension",
      "something_new",
    ]);
  });
});

describe("arcPath", () => {
  it("starts at the top for the intake arc and sweeps clockwise", () => {
    const path = arcPath(-90, -24, 118);

    // Exact at the top (no trigonometry involved) and at the radius/flags.
    expect(path.startsWith("M 180.00 62.00 A 118 118 0 0 1 ")).toBe(true);

    const [x2, y2] = path.trim().split(" ").slice(-2).map(Number);
    expect(x2).toBeGreaterThan(180);
    expect(y2).toBeLessThan(180);
  });

  it("sets the large-arc flag past a half turn", () => {
    expect(arcPath(-90, 100, 118)).toContain("A 118 118 0 1 1 ");
    expect(arcPath(-90, -24, 118)).toContain("A 118 118 0 0 1 ");
  });
});

describe("polarPercent", () => {
  it("maps the four cardinal angles to their corners of the box", () => {
    expect(polarPercent(118, -90)).toEqual({ left: "50.00%", top: "17.22%" });
    expect(polarPercent(118, 0)).toEqual({ left: "82.78%", top: "50.00%" });
    expect(polarPercent(118, 90)).toEqual({ left: "50.00%", top: "82.78%" });
    expect(polarPercent(118, 180)).toEqual({ left: "17.22%", top: "50.00%" });
  });
});
