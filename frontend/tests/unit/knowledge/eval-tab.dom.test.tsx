/**
 * 评测 tab 数据联通（2026-08-24 spec §5，plan Task 5）：
 * - useMetricsOverview / useEvalTrend 经 mock 注入数据，断言 eval-tab 的
 *   loading / 错误 / 数据三态渲染与 props 透传；
 * - 趋势空态：has_data=false（新 KB 无评测历史）渲染空态提示而非空白画布
 *   （2026-08-26 补）；
 * - 粒度切换转发给 useEvalTrend（queryKey 变化自动重新请求由 TanStack Query
 *   保证，这里断言调用参数）；
 * - drawer 占位（Task 6 替换为 EvalRunDrawer）；
 * - 窄面板降档：容器溢出（钉 scrollWidth 模拟）时粒度按钮组收进 ⋯ 菜单
 *   （vector-tab useToolbarTier 溢出检测先例）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";

const hooksMock = rs.hoisted(() => ({
  useMetricsOverview: rs.fn(),
  useEvalTrend: rs.fn(),
  useEvalRuns: rs.fn(),
  useTriggerEvalRun: rs.fn(),
  // key factories 以真实实现同款内联——组件 drain 边失效要用，测试断言同一字面量。
  knowledgeEvalLatestKey: (kbId: string) => ["knowledge-bases", kbId, "eval-runs", "latest"],
  knowledgeEvalTrendKey: (kbId: string, granularity: string) => ["knowledge-bases", kbId, "eval-runs", "trend", { granularity }],
  knowledgeEvalRunsKey: (kbId: string) => ["knowledge-bases", kbId, "eval-runs", "history"],
}));

rs.mock("@/core/knowledge/hooks", () => hooksMock);

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

/** echarts 画布 mock：记录 props，渲染占位 div（jsdom 无 canvas）。 */
const canvasMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/eval-trend-chart", () => ({
  default: (props: Record<string, unknown>) => {
    canvasMock.props = props;
    return <div data-testid="eval-trend-chart-mock" />;
  },
}));

/** EvalRunDrawer mock（Task 6）：记录 props，open 时渲染占位。 */
const drawerMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/eval-run-drawer", () => ({
  EvalRunDrawer: (props: Record<string, unknown>) => {
    drawerMock.props = props;
    return props.open ? <div data-testid="eval-run-drawer-mock" /> : null;
  },
}));

/** 题库视图 mock（Task 6）：占位壳保持 testid，bank 自身契约在其专属测试文件。 */
rs.mock("@/components/workspace/knowledge/eval-question-bank", () => ({
  EvalQuestionBank: () => <div data-testid="eval-questions-view" />,
}));

/** 历史视图 mock（Task 7）：同上，history 契约在其专属测试文件。 */
rs.mock("@/components/workspace/knowledge/eval-run-history", () => ({
  EvalRunHistory: () => <div data-testid="eval-history-view" />,
}));

// jsdom 无 ResizeObserver——组件 resize 监听用空实现顶替（panels-shell 先例）。
class ResizeObserverStub {
  observe() {
    /* no-op stub */
  }
  unobserve() {
    /* no-op stub */
  }
  disconnect() {
    /* no-op stub */
  }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { EvalTab } from "@/components/workspace/knowledge/eval-tab";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { MetricsOverview, TrendResponse } from "@/core/knowledge/types";

const OVERVIEW: MetricsOverview = {
  kb_id: "kb-1",
  layer1: {
    run_id: "run-l1",
    created_at: "2026-08-20T09:00:00+00:00",
    metrics: {
      summary: { hit_rate: 0.928, recall_at_k: 0.897, mrr: 0.812, path_accuracy: 0.946, question_count: 20 },
      fact: { hit_rate: 0.952, recall_at_k: 0.923, mrr: 0.876, path_accuracy: 0.985, question_count: 12 },
    },
  },
  layer2: null,
};

const TREND: TrendResponse = {
  points: [
    {
      date: "2026-08-20",
      recall_at_k: 0.9,
      hit_rate: 0.92,
      mrr: 0.81,
      faithfulness: 0.93,
      answer_relevancy: 0.87,
      context_precision: 0.85,
      layer1_run_id: "run-l1-1",
      layer2_run_id: "run-l2-1",
      regression: null,
      is_baseline_update: false,
    },
  ],
  granularity: "day",
  days_back: 30,
  baseline: { recall_at_k: 0.9, threshold_percent: 3 },
  has_data: true,
};

/** hook 返回形状的最小模拟：eval-tab 只消费 data/isLoading/error。 */
function queryState(overrides: {
  data?: unknown;
  isLoading?: boolean;
  error?: Error | null;
}) {
  return { data: overrides.data, isLoading: overrides.isLoading ?? false, error: overrides.error ?? null };
}

function renderEvalTab(enabled = true) {
  return renderWithClient(
    <EvalTab enabled={enabled} kbId="kb-1" />,
  );
}

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </I18nContext.Provider>,
  );
  return { ...view, queryClient };
}

describe("EvalTab 数据联通", () => {
  beforeEach(() => {
    canvasMock.props = undefined;
    drawerMock.props = undefined;
    hooksMock.useMetricsOverview.mockReset();
    hooksMock.useEvalTrend.mockReset();
    hooksMock.useEvalRuns.mockReset();
    hooksMock.useTriggerEvalRun.mockReset();
    // 缺省：查询就绪且有数据；历史空闲、无触发在途
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ data: OVERVIEW }));
    hooksMock.useEvalTrend.mockImplementation((_kbId: string, granularity: string) =>
      queryState({ data: granularity === "day" ? TREND : { ...TREND, granularity } }),
    );
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [], total: 0 } }));
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate: rs.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("forwards kbId/enabled to all three data hooks (keep-alive lazy gating)", () => {
    renderEvalTab(true);
    expect(hooksMock.useMetricsOverview).toHaveBeenCalledWith("kb-1", true);
    expect(hooksMock.useEvalTrend).toHaveBeenCalledWith("kb-1", "day", true);
    expect(hooksMock.useEvalRuns).toHaveBeenCalledWith("kb-1", true);

    cleanup();
    renderEvalTab(false);
    expect(hooksMock.useMetricsOverview).toHaveBeenLastCalledWith("kb-1", false);
    expect(hooksMock.useEvalTrend).toHaveBeenLastCalledWith("kb-1", "day", false);
    expect(hooksMock.useEvalRuns).toHaveBeenLastCalledWith("kb-1", false);
  });

  it("renders overview table and trend chart shell on data", async () => {
    renderEvalTab();
    // 指标总览
    expect(screen.getByTestId("eval-layer1-table")).toBeTruthy();
    // 趋势卡片壳 + 粒度按钮组（内联档）
    expect(screen.getByText("指标趋势")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "时间粒度" })).toBeTruthy();
    // 趋势 canvas（dynamic 懒加载，mock 后异步落地）
    await screen.findByTestId("eval-trend-chart-mock");
    // props 透传：points/baseline/granularity + i18n labels 包
    expect(canvasMock.props?.points).toEqual(TREND.points);
    expect(canvasMock.props?.baseline).toEqual(TREND.baseline);
    expect(canvasMock.props?.granularity).toBe("day");
    const labels = canvasMock.props?.labels as { recallAtK?: string; thresholdLabel?: (p: number) => string };
    expect(labels.recallAtK).toBe("Recall@k");
    expect(labels.thresholdLabel?.(3)).toBe("回退阈值 -3%");
  });

  it("32rem 下限只在指标总览块：压缩时仅卡片区域横滚，工具栏不进滚动区", () => {
    renderEvalTab();
    // 2026-08-28 修订（用户反馈）：下限从整列下沉到指标块——「谁有下限，谁自己滚」。
    const scrollBlock = screen.getByTestId("eval-overview-scroll");
    expect(scrollBlock.className).toContain("overflow-x-auto");
    expect(scrollBlock.firstElementChild?.className).toContain("min-w-[32rem]");
    // 工具栏固定行，整 tab 无横向滚动
    expect(screen.getByTestId("eval-view-toolbar").className).toContain("shrink-0");
    expect(screen.getByTestId("eval-tab").className).not.toContain("overflow-auto");
  });

  it("loading 状态渲染加载提示而非空白", () => {
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ isLoading: true }));
    hooksMock.useEvalTrend.mockReturnValue(queryState({ isLoading: true }));
    renderEvalTab();
    expect(screen.getAllByText("加载中…").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("eval-layer1-table")).toBeNull();
    expect(screen.queryByTestId("eval-trend-chart-mock")).toBeNull();
  });

  it("错误状态渲染加载失败提示", () => {
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ error: new Error("boom") }));
    hooksMock.useEvalTrend.mockReturnValue(queryState({ error: new Error("boom") }));
    renderEvalTab();
    expect(screen.getAllByText("评测数据加载失败").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("eval-layer1-table")).toBeNull();
  });

  it("trend.has_data=false 渲染空态提示而非空白画布（新 KB 无评测历史）", async () => {
    hooksMock.useEvalTrend.mockReturnValue(
      queryState({ data: { ...TREND, points: [], has_data: false, baseline: null } }),
    );
    renderEvalTab();
    expect(screen.getByText("暂无评测趋势数据")).toBeTruthy();
    expect(screen.queryByTestId("eval-trend-chart-mock")).toBeNull();
    // 给 dynamic import 一个兑现窗口，确认 canvas 不会被加载
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(canvasMock.props).toBeUndefined();
  });

  it("granularity radio click forwards to useEvalTrend (queryKey 变化自动重查)", () => {
    renderEvalTab();
    fireEvent.click(screen.getByRole("radio", { name: "周" }));
    expect(hooksMock.useEvalTrend).toHaveBeenLastCalledWith("kb-1", "week", true);
  });

  it("clicking a trend point opens the run drawer; closing clears the run id", async () => {
    renderEvalTab();
    await screen.findByTestId("eval-trend-chart-mock");
    const onPointClick = canvasMock.props?.onPointClick as ((runId: string) => void) | undefined;
    expect(onPointClick).toBeTypeOf("function");
    // 点击数据点 → drawer 打开并携带 runId（GET /eval-runs/{run_id} 由 drawer 内的
    // useEvalRun 发起，见 eval-run-drawer.dom.test.tsx）
    act(() => onPointClick?.("run-l1-1"));
    expect(screen.getByTestId("eval-run-drawer-mock")).toBeTruthy();
    expect(drawerMock.props?.runId).toBe("run-l1-1");
    expect(drawerMock.props?.open).toBe(true);
    expect(drawerMock.props?.kbId).toBe("kb-1");
    // 关闭 → 清空 runId，drawer 卸载
    act(() => (drawerMock.props?.onOpenChange as (open: boolean) => void)(false));
    await waitFor(() => {
      expect(screen.queryByTestId("eval-run-drawer-mock")).toBeNull();
    });
  });

  it("窄面板降档：容器溢出时粒度按钮组收进 ⋯ 菜单", async () => {
    // jsdom 无布局——把工具栏 scrollWidth 钉成大值模拟溢出（clientWidth 恒 0），
    // 对齐 vector-tab 测试先例。
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "eval-trend-toolbar" ? 999 : 0;
      },
    });
    try {
      renderEvalTab();
      await screen.findByTestId("eval-trend-chart-mock");
      // 内联粒度按钮组消失，⋯ 按钮出现
      await waitFor(() => {
        expect(screen.queryByRole("radiogroup", { name: "时间粒度" })).toBeNull();
      });
      const more = screen.getByRole("button", { name: "更多选项" });
      // 菜单内承载粒度切换（Radix 键盘开菜单，vector-tab 先例）
      fireEvent.keyDown(more, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("menuitemradio", { name: "月" }));
      expect(hooksMock.useEvalTrend).toHaveBeenLastCalledWith("kb-1", "month", true);
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      } else {
        delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });
});

// ── 二期工具栏与三视图（2026-08-27 spec §3/§5，plan Task 5）──────────────

const RUN_SUMMARY = {
  run_id: "run-latest",
  created_at: "2026-08-20T09:00:00+00:00",
  completed_at: null,
  environment: "local",
  status: "completed",
  is_baseline: false,
  has_layer1: true,
  has_layer2: false,
  regression_detected: false,
  langfuse_trace_url: null,
};

describe("EvalTab 三视图切换", () => {
  beforeEach(() => {
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ data: OVERVIEW }));
    hooksMock.useEvalTrend.mockReturnValue(queryState({ data: TREND }));
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [], total: 0 } }));
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate: rs.fn(), isPending: false });
  });
  afterEach(() => cleanup());

  it("默认渲染总览视图（3 秒判断：健康度永远先看到）", () => {
    renderEvalTab();
    expect(screen.getByTestId("eval-layer1-table")).toBeTruthy();
    expect(screen.queryByTestId("eval-questions-view")).toBeNull();
    expect(screen.queryByTestId("eval-history-view")).toBeNull();
  });

  it("分段控件切换题库/历史视图（Task 6/7 填充前的占位壳）", () => {
    renderEvalTab();
    const group = screen.getByRole("radiogroup", { name: "评测视图切换" });
    expect(group).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "题库" }));
    expect(screen.getByTestId("eval-questions-view")).toBeTruthy();
    // 管理型内容不与健康度总览抢首屏：切走后总览卸载
    expect(screen.queryByTestId("eval-layer1-table")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "历史" }));
    expect(screen.getByTestId("eval-history-view")).toBeTruthy();
    expect(screen.queryByTestId("eval-questions-view")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "总览" }));
    expect(screen.getByTestId("eval-layer1-table")).toBeTruthy();
  });
});

describe("EvalTab 常驻工具栏", () => {
  beforeEach(() => {
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ data: OVERVIEW }));
    hooksMock.useEvalTrend.mockReturnValue(queryState({ data: TREND }));
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate: rs.fn(), isPending: false });
  });
  afterEach(() => cleanup());

  it("无历史行显示「尚未运行」", () => {
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [], total: 0 } }));
    renderEvalTab();
    expect(screen.getByText("尚未运行")).toBeTruthy();
  });

  it("有历史行显示「上次运行 X 前」短文案", () => {
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [RUN_SUMMARY], total: 1 } }));
    renderEvalTab();
    // 相对时间随时钟漂移，只钉前缀（formatTimeAgo 产物拼在后面）
    expect(screen.getByText("上次运行", { exact: false })).toBeTruthy();
    expect(screen.getByTestId("eval-view-toolbar").textContent).toContain("上次运行");
  });

  it("in_flight=true 时按钮转「运行中…」禁用态", () => {
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: true, runs: [], total: 0 } }));
    renderEvalTab();
    const runButton = screen.getByRole("button", { name: "运行中…" });
    expect(runButton.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "运行评测" })).toBeNull();
  });

  it("mutation pending 同样呈现运行中禁用态（点击→首次轮询间隙）", () => {
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [], total: 0 } }));
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate: rs.fn(), isPending: true });
    renderEvalTab();
    expect(screen.getByRole("button", { name: "运行中…" }).hasAttribute("disabled")).toBe(true);
  });

  it("点击运行 → enqueued 成功 toast", () => {
    const mutate = rs.fn((_vars: unknown, opts?: { onSuccess?: (r: { status: string }) => void }) => {
      opts?.onSuccess?.({ status: "enqueued" });
    });
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate, isPending: false });
    renderEvalTab();

    fireEvent.click(screen.getByRole("button", { name: "运行评测" }));

    expect(mutate).toHaveBeenCalled();
    expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "评测已开始")).toBe(true);
  });

  it("already_running → 提示 toast，不报错", () => {
    const mutate = rs.fn((_vars: unknown, opts?: { onSuccess?: (r: { status: string }) => void }) => {
      opts?.onSuccess?.({ status: "already_running" });
    });
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate, isPending: false });
    renderEvalTab();

    fireEvent.click(screen.getByRole("button", { name: "运行评测" }));

    expect(rs.mocked(toast.info).mock.calls.some(([m]) => m === "已有评测正在运行")).toBe(true);
    expect(rs.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("触发失败 → 错误 toast", () => {
    const mutate = rs.fn((_vars: unknown, opts?: { onError?: () => void }) => {
      opts?.onError?.();
    });
    hooksMock.useTriggerEvalRun.mockReturnValue({ mutate, isPending: false });
    renderEvalTab();

    fireEvent.click(screen.getByRole("button", { name: "运行评测" }));

    expect(rs.mocked(toast.error).mock.calls.some(([m]) => m === "评测触发失败")).toBe(true);
  });

  it("drain 边：in_flight true→false 一次性失效三个评测 query", () => {
    let runsState = queryState({ data: { in_flight: true, runs: [], total: 0 } });
    hooksMock.useEvalRuns.mockImplementation(() => runsState);
    const { queryClient, rerender } = renderWithClient(<EvalTab enabled kbId="kb-1" />);
    const invalidateSpy = rs.fn().mockResolvedValue(undefined);
    queryClient.invalidateQueries = invalidateSpy as typeof queryClient.invalidateQueries;

    // 初始挂载（含 in_flight=true 首见）不触发失效
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      runsState = queryState({ data: { in_flight: false, runs: [], total: 0 } });
      rerender(
        <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
          <QueryClientProvider client={queryClient}>
            <EvalTab enabled kbId="kb-1" />
          </QueryClientProvider>
        </I18nContext.Provider>,
      );
    });

    const keys = invalidateSpy.mock.calls.map(([arg]) => (arg as { queryKey: readonly unknown[] }).queryKey);
    expect(keys).toContainEqual(["knowledge-bases", "kb-1", "eval-runs", "history"]);
    expect(keys).toContainEqual(["knowledge-bases", "kb-1", "eval-runs", "latest"]);
    expect(keys).toContainEqual(["knowledge-bases", "kb-1", "eval-runs", "trend", { granularity: "day" }]);
  });

  it("窄面板降档：视图工具栏溢出时运行按钮收进 ⋯ 菜单", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "eval-view-toolbar" ? 999 : 0;
      },
    });
    hooksMock.useEvalRuns.mockReturnValue(queryState({ data: { in_flight: false, runs: [], total: 0 } }));
    try {
      const mutate = rs.fn();
      hooksMock.useTriggerEvalRun.mockReturnValue({ mutate, isPending: false });
      renderEvalTab();
      await screen.findByTestId("eval-trend-chart-mock");
      // 内联运行按钮消失，视图工具栏自己的 ⋯ 按钮出现（趋势工具栏不受影响）
      await waitFor(() => {
        expect(within(screen.getByTestId("eval-view-toolbar")).queryByRole("button", { name: "运行评测" })).toBeNull();
      });
      const more = within(screen.getByTestId("eval-view-toolbar")).getByRole("button", { name: "更多选项" });
      fireEvent.keyDown(more, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "运行评测" }));
      expect(mutate).toHaveBeenCalled();
      // 分段控件恒内联：三视图标签足够短
      expect(screen.getByRole("radiogroup", { name: "评测视图切换" })).toBeTruthy();
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      } else {
        delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });

  it("tier 1 时状态文案让位（次要信息先收缩，分段控件与 ⋯ 恒在）", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "eval-view-toolbar" ? 999 : 0;
      },
    });
    try {
      renderEvalTab();
      // 状态文案（「尚未运行」/「上次运行 X 前」）只在 tier 0 展示
      expect(screen.queryByText("尚未运行")).toBeNull();
      expect(screen.getByRole("radiogroup", { name: "评测视图切换" })).toBeTruthy();
      expect(within(screen.getByTestId("eval-view-toolbar")).getByRole("button", { name: "更多选项" })).toBeTruthy();
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      } else {
        delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });
});
