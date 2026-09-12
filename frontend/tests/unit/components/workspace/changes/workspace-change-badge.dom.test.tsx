import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import type { DeliveryReceipt } from "@/core/delivery/types";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { WorkspaceChangesResponse } from "@/core/workspace-changes/types";

/**
 * The delivery verdict as a line on the existing workspace-change card.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §4.
 * Four shapes matter, and two of them are about *not* doing something: a run
 * with no receipt still gets its file card (dropping it because an unrelated
 * read came back empty would hide the very list the line comments on), and the
 * card's own visibility gate stays exactly as it was — the line must not widen
 * it.
 *
 * The assertions spell the copy out literally rather than reading it back from
 * the locale: that is what makes them a check on the frozen strings instead of
 * on themselves.
 */
const deliveryState = rs.hoisted(() => ({
  value: null as DeliveryReceipt | null,
}));

rs.mock("@/core/delivery/hooks", () => ({
  useDelivery: () => ({ data: deliveryState.value, isLoading: false }),
}));

rs.mock("@/core/workspace-changes/hooks", () => ({
  useWorkspaceChanges: () => ({
    data: {
      available: true,
      version: 1,
      summary: {
        created: 1,
        modified: 0,
        deleted: 0,
        symlink_created: 0,
        additions: 3,
        deletions: 0,
        truncated: false,
      },
      files: [
        {
          path: "/mnt/user-data/outputs/report.md",
          root: "outputs",
          status: "created",
          additions: 3,
          deletions: 0,
        },
      ],
      limits: {},
    } as unknown as WorkspaceChangesResponse,
    isLoading: false,
  }),
}));

const { WorkspaceChangeBadge } =
  await import("@/components/workspace/changes/workspace-change-badge");

beforeEach(() => {
  deliveryState.value = null;
});

afterEach(cleanup);

function receipt(
  stage: "presented" | "mismatched" | "not_started",
  satisfied: boolean,
  counts: { produced: number; presented: number; matched: number },
): DeliveryReceipt {
  return {
    presented: counts.presented,
    paths: [],
    by_tool: {},
    verdict: {
      stage,
      satisfied,
      verification: { source: "outputs_changed", requirement: "p" },
      produced_paths: Array.from(
        { length: counts.produced },
        (_, i) => `/o/${i}.md`,
      ),
      presented_paths: Array.from(
        { length: counts.presented },
        (_, i) => `/p/${i}.md`,
      ),
      matched_paths: Array.from(
        { length: counts.matched },
        (_, i) => `/m/${i}.md`,
      ),
    },
  };
}

function renderBadge() {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <WorkspaceChangeBadge threadId="thread-1" runId="run-1" />
    </I18nContext.Provider>,
  );
}

describe("WorkspaceChangeBadge delivery line", () => {
  it("states the verdict quietly when the run handed its output over", () => {
    deliveryState.value = receipt("presented", true, {
      produced: 3,
      presented: 3,
      matched: 3,
    });

    renderBadge();

    const line = screen.getByTestId("delivery-verdict");
    expect(line.textContent).toBe("已交出 3/3 个产物");
    // Quiet: the shared tone for "nothing to worry about", not an accent.
    expect(line.className).toContain("text-muted-foreground");
    expect(line.className).not.toContain("text-destructive");
  });

  it("reports a partial hand-over without dressing it as success", () => {
    // `satisfied` only requires a non-empty match, so 1 of 3 still passes — and
    // the line must not claim "all" when it was not.
    deliveryState.value = receipt("presented", true, {
      produced: 3,
      presented: 1,
      matched: 1,
    });

    renderBadge();

    expect(screen.getByTestId("delivery-verdict").textContent).toBe(
      "已交出 1/3 个产物",
    );
  });

  it("raises the tone when what was handed over was not this run's output", () => {
    deliveryState.value = receipt("mismatched", false, {
      produced: 3,
      presented: 2,
      matched: 0,
    });

    renderBadge();

    const line = screen.getByTestId("delivery-verdict");
    expect(line.textContent).toBe("交出了 2 个，但都不是这次产出的");
    expect(line.className).toContain("text-destructive");
  });

  it("raises the tone when nothing was handed over at all", () => {
    deliveryState.value = receipt("not_started", false, {
      produced: 2,
      presented: 0,
      matched: 0,
    });

    renderBadge();

    const line = screen.getByTestId("delivery-verdict");
    expect(line.textContent).toBe("产出了 2 个，一个都没交出");
    expect(line.className).toContain("text-destructive");
  });

  it("keeps the file card when the run published no verdict", () => {
    // The majority shape. Switching on the receipt rather than the verdict would
    // print "handed over 0" on almost every run.
    deliveryState.value = {
      presented: 0,
      paths: [],
      by_tool: {},
      verdict: null,
    };

    renderBadge();

    expect(screen.queryByTestId("delivery-verdict")).toBeNull();
  });

  it("keeps the file card when the receipt read came back empty", () => {
    deliveryState.value = null;

    renderBadge();

    expect(screen.queryByTestId("delivery-verdict")).toBeNull();
    expect(screen.getByText(zhCN.workspaceChanges.editedTitle(1))).toBeTruthy();
  });
});
