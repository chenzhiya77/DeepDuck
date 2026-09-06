/**
 * 历史视图契约测试（2026-08-27 spec §6.2，plan Task 7）：
 * - 行渲染：⭐baseline 标记 + 时间 + 环境 Badge + 层徽标 + 状态短文案 + 回退红 Badge；
 * - skipped/error 行可见（历史是唯一曝光面——不进 latest/trend）；
 * - 行点击 → onOpenRun 携带 runId（drawer 实例由 eval-tab 持有，与趋势点共用）；
 * - 三态 + in_flight 不产生伪行（运行中只由工具栏 spinner 表达）；
 * - formatRunTime 纯函数（spec ASCII 示例的 MM-DD HH:mm 口径）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const hooksMock = rs.hoisted(() => ({
  useEvalRuns: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => hooksMock);

const drawerMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/eval-run-drawer", () => ({
  EvalRunDrawer: (props: Record<string, unknown>) => {
    drawerMock.props = props;
    return props.open ? <div data-testid="eval-run-drawer-mock" /> : null;
  },
}));

import { EvalRunHistory, formatRunTime } from "@/components/workspace/knowledge/eval-run-history";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { EvalRunSummary } from "@/core/knowledge/types";

const RUN_BASELINE: EvalRunSummary = {
  run_id: "run-baseline",
  created_at: "2026-08-26T14:30:00+00:00",
  completed_at: "2026-08-26T14:31:00+00:00",
  environment: "local",
  status: "completed",
  is_baseline: true,
  has_layer1: true,
  has_layer2: false,
  regression_detected: false,
  langfuse_trace_url: null,
};

const RUN_CI_ERROR: EvalRunSummary = {
  run_id: "run-ci",
  created_at: "2026-08-25T09:12:00+00:00",
  completed_at: null,
  environment: "ci",
  status: "error",
  is_baseline: false,
  has_layer1: false,
  has_layer2: true,
  regression_detected: false,
  langfuse_trace_url: null,
};

const RUN_REGRESSED: EvalRunSummary = {
  run_id: "run-regressed",
  created_at: "2026-08-24T03:00:00+00:00",
  completed_at: null,
  environment: "nightly",
  status: "completed",
  is_baseline: false,
  has_layer1: true,
  has_layer2: true,
  regression_detected: true,
  langfuse_trace_url: "https://langfuse.example/trace/7",
};

// 终止行（spec 2026-09-06 §11）：status 自由字符串列零迁移，历史行是唯一曝光面。
const RUN_CANCELLED: EvalRunSummary = {
  run_id: "run-cancelled",
  created_at: "2026-09-06T06:00:00+00:00",
  completed_at: "2026-09-06T06:03:00+00:00",
  environment: "local",
  status: "cancelled",
  is_baseline: false,
  has_layer1: true,
  has_layer2: true,
  regression_detected: false,
  langfuse_trace_url: null,
};

function runsState(runs: EvalRunSummary[], inFlight = false) {
  return { data: { in_flight: inFlight, runs, total: runs.length }, error: null, isLoading: false };
}

function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {ui}
    </I18nContext.Provider>,
  );
}

function renderHistory(runs: EvalRunSummary[], inFlight = false) {
  hooksMock.useEvalRuns.mockReturnValue(runsState(runs, inFlight));
  const onOpenRun = rs.fn();
  renderWithI18n(<EvalRunHistory enabled kbId="kb-1" onOpenRun={onOpenRun} />);
  return onOpenRun;
}

beforeEach(() => {
  drawerMock.props = undefined;
  hooksMock.useEvalRuns.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EvalRunHistory 行渲染", () => {
  it("环境/层/状态/badge 组合正确；⭐ 与回退标红各就位", () => {
    renderHistory([RUN_BASELINE, RUN_CI_ERROR, RUN_REGRESSED]);
    // 环境三值
    expect(screen.getByText("本地")).toBeTruthy();
    expect(screen.getByText("CI")).toBeTruthy();
    expect(screen.getByText("定时")).toBeTruthy();
    // 层徽标：L1 / L2 / L1+L2（精确匹配，防 L1 子串命中 L1+L2）
    expect(screen.getByText("L1")).toBeTruthy();
    expect(screen.getByText("L2")).toBeTruthy();
    expect(screen.getByText("L1+L2")).toBeTruthy();
    // 状态短文案
    expect(screen.getAllByText("完成").length).toBe(2);
    expect(screen.getByText("失败")).toBeTruthy();
    // baseline ⭐ 只在标记行
    expect(screen.getAllByTestId("eval-run-baseline-star")).toHaveLength(1);
    // 回退红 Badge（skipped/error 不进 latest/trend——历史是唯一曝光面）
    expect(screen.getByText("检测到回退")).toBeTruthy();
  });

  it("in_flight=true 不产生伪行（运行中只由工具栏 spinner 表达）", () => {
    renderHistory([RUN_BASELINE], true);
    // 只有那一行已落库的运行，没有「运行中」伪行
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("eval-run-baseline-star")).toBeTruthy();
  });

  it("行点击 → onOpenRun 携带 runId（复用 eval-tab 的 drawer 实例）", () => {
    const onOpenRun = renderHistory([RUN_CI_ERROR]);
    fireEvent.click(screen.getByRole("button", { name: /CI/ }));
    expect(onOpenRun).toHaveBeenCalledWith("run-ci");
  });

  it("cancelled 行渲染「已终止」状态短文案（spec §11）", () => {
    renderHistory([RUN_CANCELLED]);
    expect(screen.getByText("已终止")).toBeTruthy();
    expect(screen.queryByText("失败")).toBeNull();
    expect(screen.queryByText("跳过")).toBeNull();
  });

  it("空历史渲染空态引导", () => {
    renderHistory([]);
    expect(screen.getByText("尚无评测运行——点右上角运行评测发起首次评测")).toBeTruthy();
  });

  it("loading 与错误三态", () => {
    hooksMock.useEvalRuns.mockReturnValue({ data: undefined, error: null, isLoading: true });
    renderWithI18n(<EvalRunHistory enabled kbId="kb-1" onOpenRun={() => undefined} />);
    expect(screen.getByText("加载中…")).toBeTruthy();

    cleanup();
    hooksMock.useEvalRuns.mockReturnValue({ data: undefined, error: new Error("boom"), isLoading: false });
    renderWithI18n(<EvalRunHistory enabled kbId="kb-1" onOpenRun={() => undefined} />);
    expect(screen.getByText("评测数据加载失败")).toBeTruthy();
  });
});

describe("formatRunTime（纯函数）", () => {
  it("按 MM-DD HH:mm 口径格式化", () => {
    expect(formatRunTime("2026-08-26T14:30:00+00:00")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("null 或非法时间返回 -", () => {
    expect(formatRunTime(null)).toBe("-");
    expect(formatRunTime("not-a-date")).toBe("-");
  });
});
