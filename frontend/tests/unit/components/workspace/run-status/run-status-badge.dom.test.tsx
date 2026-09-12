import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { runOutcomeQueryKey } from "@/core/run-status/hooks";

/**
 * The run's ending chip.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.2 / D3. The statuses are driven through the real projection and classifier by
 * mocking only the API, so these cases also pin the status-to-kind mapping rather
 * than restating a mocked verdict back to itself.
 *
 * The assertions spell the copy out literally: that is what makes them a check on
 * the frozen strings instead of on themselves.
 */
const runState = rs.hoisted(() => ({
  row: null as unknown,
  read: rs.fn(async () => null as unknown),
}));

rs.mock("@/core/api", () => ({
  getAPIClient: () => ({ runs: { get: runState.read } }),
}));

const { RunStatusBadge } =
  await import("@/components/workspace/run-status/run-status-badge");

beforeEach(() => {
  runState.read.mockClear();
});

afterEach(cleanup);

function renderBadge(status: Record<string, unknown>, enabled = true) {
  runState.row = status;
  runState.read.mockImplementation(async () => runState.row);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
      >
        <RunStatusBadge threadId="thread-1" runId="run-1" enabled={enabled} />
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * The chip is absent, and the query really settled with data first.
 *
 * Waiting only for the read to happen would not be enough: the request starts
 * before its result lands, so an absence assertion taken then passes even when the
 * component would draw a chip a moment later. The cache is the positive signal.
 */
async function expectNoChip(queryClient: QueryClient) {
  await waitFor(() =>
    expect(
      queryClient.getQueryData(runOutcomeQueryKey("thread-1", "run-1")),
    ).toBeTruthy(),
  );
  expect(screen.queryByTestId("run-status-badge")).toBeNull();
}

describe("RunStatusBadge", () => {
  it("reports a failed run", async () => {
    renderBadge({ status: "error", error: "boom" });

    const badge = await screen.findByTestId("run-status-badge");
    expect(badge.textContent).toBe("这次没跑完");
    expect(badge.className).toContain("text-destructive");
  });

  it("reports a timed-out run as the same ending", async () => {
    renderBadge({ status: "timeout" });

    expect((await screen.findByTestId("run-status-badge")).textContent).toBe(
      "这次没跑完",
    );
  });

  it("reports a stopped run quietly", async () => {
    renderBadge({ status: "interrupted" });

    const badge = await screen.findByTestId("run-status-badge");
    expect(badge.textContent).toBe("已停止");
    // Neutral: the reader stopped it, so this is a confirmation, not an alarm.
    expect(badge.className).toContain("text-muted-foreground");
    expect(badge.className).not.toContain("text-destructive");
  });

  it("says nothing about a run that succeeded", async () => {
    // A chip here would be noise on every working run.
    const queryClient = renderBadge({ status: "success" });

    await expectNoChip(queryClient);
  });

  it("says nothing about a run that has not ended", async () => {
    const queryClient = renderBadge({ status: "running" });

    await expectNoChip(queryClient);
  });

  it("does not read while the thread is still streaming", async () => {
    // Found on the real stack, not here: a group's own `isLoading` is only true for
    // the *last* group, and during a run the anchor is usually not the last group —
    // so a per-group flag let this read happen mid-run. It answered `running`, and
    // because the answer is cached for the run's lifetime, the real ending was
    // never judged and the chip never appeared. The caller now holds it off with
    // the thread-level flag, and this pins that the flag is honoured.
    const queryClient = renderBadge({ status: "error", error: "boom" }, false);

    await act(async () => {
      await Promise.resolve();
    });

    expect(runState.read).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(runOutcomeQueryKey("thread-1", "run-1")),
    ).toBeUndefined();
    expect(screen.queryByTestId("run-status-badge")).toBeNull();
  });
});
