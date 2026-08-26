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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hooksMock = rs.hoisted(() => ({
  useMetricsOverview: rs.fn(),
  useEvalTrend: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => ({
  useMetricsOverview: hooksMock.useMetricsOverview,
  useEvalTrend: hooksMock.useEvalTrend,
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
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <EvalTab enabled={enabled} kbId="kb-1" />
    </I18nContext.Provider>,
  );
}

describe("EvalTab 数据联通", () => {
  beforeEach(() => {
    canvasMock.props = undefined;
    drawerMock.props = undefined;
    hooksMock.useMetricsOverview.mockReset();
    hooksMock.useEvalTrend.mockReset();
    // 缺省：两查询就绪且有数据
    hooksMock.useMetricsOverview.mockReturnValue(queryState({ data: OVERVIEW }));
    hooksMock.useEvalTrend.mockImplementation((_kbId: string, granularity: string) =>
      queryState({ data: granularity === "day" ? TREND : { ...TREND, granularity } }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("forwards kbId/enabled to both hooks (keep-alive lazy gating)", () => {
    renderEvalTab(true);
    expect(hooksMock.useMetricsOverview).toHaveBeenCalledWith("kb-1", true);
    expect(hooksMock.useEvalTrend).toHaveBeenCalledWith("kb-1", "day", true);

    cleanup();
    renderEvalTab(false);
    expect(hooksMock.useMetricsOverview).toHaveBeenLastCalledWith("kb-1", false);
    expect(hooksMock.useEvalTrend).toHaveBeenLastCalledWith("kb-1", "day", false);
  });

  it("renders run-config note, overview table and trend chart shell on data", async () => {
    renderEvalTab();
    // 运行配置区：触发按钮落地前仅一行说明文案
    expect(screen.getByTestId("eval-tab").textContent).toContain("CLI");
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

  it("keeps the tab-level min-width floor so narrow panels scroll instead of clipping", () => {
    renderEvalTab();
    // 内包装下限（2026-08-27 三轮）：卡片可压到的最小宽度由这里保护，触底整 tab 横滚。
    expect(screen.getByTestId("eval-tab").firstElementChild?.className).toContain("min-w-[32rem]");
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
