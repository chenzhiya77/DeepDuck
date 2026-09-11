import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConstitutionRing } from "@/components/workspace/constitution/constitution-ring";
import {
  BADGE_RADIUS,
  LABEL_RADIUS,
  OUTSIDE_BAND_RADIUS,
  arcPath,
  polarPercent,
  ringLayout,
} from "@/core/constitution/geometry";
import type { ConstitutionStage } from "@/core/constitution/types";
import { zhCN } from "@/core/i18n/locales/zh-CN";

/**
 * The ring drawing primitive.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §5.
 * The geometry itself is pinned in `core/constitution/geometry.test.ts`; what
 * this file pins is the drawing: five arcs on the ring, the loop track only on
 * the looping stages, the out-of-ring band for everything else, the handoff
 * exit only where a stage hands off, and a gate badge that counts gates and
 * handoffs separately.
 *
 * The component takes its copy as props (no i18n import), so a label here is a
 * marker rather than the real string — that keeps the two tiers' vocabularies
 * out of the drawing layer by construction.
 */
const T = zhCN.constitution;

afterEach(cleanup);

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

const RING = ["intake", "context", "model", "tools", "epilogue"].map((key) =>
  stage(key),
);

const labelForStage = (key: string) => `label:${key}`;

function renderRing(
  stages: ConstitutionStage[],
  props: Partial<Parameters<typeof ConstitutionRing>[0]> = {},
) {
  return render(
    <ConstitutionRing
      stages={stages}
      labelForStage={labelForStage}
      segmentLabel={T.a11y.segment}
      {...props}
    />,
  );
}

describe("ConstitutionRing layout", () => {
  it("draws one arc per stage and labels each as a ring segment", () => {
    renderRing(RING);

    const arcs = RING.map((entry) =>
      screen.getByTestId(`constitution-arc-${entry.key}`),
    );
    expect(arcs).toHaveLength(5);
    arcs.forEach((arc, index) => {
      expect(arc.getAttribute("aria-label")).toBe(T.a11y.segment(index + 1, 5));
    });
  });

  it("draws the loop track only on the looping stages", () => {
    renderRing(RING);

    expect(screen.getByTestId("constitution-loop-context")).toBeTruthy();
    expect(screen.getByTestId("constitution-loop-model")).toBeTruthy();
    expect(screen.getByTestId("constitution-loop-tools")).toBeTruthy();
    expect(screen.queryByTestId("constitution-loop-intake")).toBeNull();
    expect(screen.queryByTestId("constitution-loop-epilogue")).toBeNull();
  });

  it("keeps the extension band and unrecognized stages off the ring", () => {
    renderRing([
      ...RING,
      stage("extension", { loop: false, members: 1 }),
      stage("something_new", { loop: false, members: 3 }),
    ]);

    // Still five arcs: neither of the two extra stages is laid out on the ring.
    expect(screen.getAllByTestId(/^constitution-arc-/)).toHaveLength(5);
    expect(screen.getByTestId("constitution-outside-band")).toBeTruthy();
    expect(screen.getByTestId("constitution-outside-extension")).toBeTruthy();
    expect(
      screen.getByTestId("constitution-outside-something_new"),
    ).toBeTruthy();
  });

  it("hangs the band outside the exit arc, not on the ring's seam", () => {
    // The frozen decision (constitution spec §8 risk 11) is "outside the exit
    // arc". A band centred on the seam would read as belonging to neither side,
    // and it is one line of code away from happening.
    renderRing([...RING, stage("extension", { loop: false })]);

    const exit = ringLayout(RING).ring.find((arc) => arc.key === "epilogue")!;
    expect(
      screen.getByTestId("constitution-outside-band").getAttribute("d"),
    ).toBe(arcPath(exit.startDeg, exit.endDeg, OUTSIDE_BAND_RADIUS));
    expect(
      screen.getByTestId("constitution-outside-nodes").getAttribute("style"),
    ).toContain(polarPercent(OUTSIDE_BAND_RADIUS, exit.centerDeg).left);
  });

  it("places every label inside the ring and every badge on its arc", () => {
    renderRing(RING.map((entry) => ({ ...entry, gates: 1 })));

    ringLayout(RING).ring.forEach((arc) => {
      const label = polarPercent(LABEL_RADIUS, arc.centerDeg);
      expect(
        screen
          .getByTestId(`constitution-node-${arc.key}`)
          .getAttribute("style"),
      ).toBe(`left: ${label.left}; top: ${label.top};`);

      const badge = polarPercent(BADGE_RADIUS, arc.centerDeg);
      expect(
        screen
          .getByTestId(`constitution-badge-${arc.key}`)
          .getAttribute("style"),
      ).toBe(`left: ${badge.left}; top: ${badge.top};`);
    });
  });

  it("omits the out-of-ring band entirely when every stage fits", () => {
    renderRing(RING);

    expect(screen.queryByTestId("constitution-outside-band")).toBeNull();
  });

  it("draws the handoff exit only where a stage hands off", () => {
    const { unmount } = renderRing(RING);
    expect(screen.queryByTestId("constitution-handoff-exit")).toBeNull();
    unmount();

    renderRing(
      RING.map((entry) =>
        entry.key === "tools" ? { ...entry, handoff_gates: 1 } : entry,
      ),
    );
    expect(screen.getByTestId("constitution-handoff-exit")).toBeTruthy();
  });
});

describe("ConstitutionRing gate badges", () => {
  it("counts gates plus handoffs, and marks the handoff apart", () => {
    renderRing(
      RING.map((entry) => {
        if (entry.key === "model") {
          return { ...entry, gates: 3 };
        }
        if (entry.key === "tools") {
          return { ...entry, gates: 2, handoff_gates: 1 };
        }
        return entry;
      }),
    );

    expect(
      screen.getByTestId("constitution-badge-total-model").textContent,
    ).toBe("3");
    expect(
      screen.getByTestId("constitution-badge-total-tools").textContent,
    ).toBe("3");
    expect(screen.queryByTestId("constitution-badge-handoff-model")).toBeNull();
    expect(
      screen
        .getByTestId("constitution-badge-handoff-tools")
        .getAttribute("data-handoff"),
    ).toBe("true");
  });

  it("draws no badge for a stage with no gate of either kind", () => {
    renderRing(RING);

    expect(screen.queryByTestId("constitution-badge-intake")).toBeNull();
    expect(screen.queryByTestId("constitution-badge-model")).toBeNull();
  });
});

describe("ConstitutionRing interaction", () => {
  it("reports the stage a click hit", () => {
    const selected: string[] = [];
    renderRing(RING, { onSelectStage: (key) => selected.push(key) });

    fireEvent.click(screen.getByTestId("constitution-arc-tools"));
    expect(selected).toEqual(["tools"]);
  });

  it("marks the selected arc and its overlay node as pressed", () => {
    renderRing(RING, { selectedKey: "context" });

    expect(
      screen
        .getByTestId("constitution-arc-context")
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("constitution-node-context")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("constitution-node-tools")
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
