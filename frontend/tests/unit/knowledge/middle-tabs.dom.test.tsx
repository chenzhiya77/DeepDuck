/**
 * 评测 tab 挂载（2026-08-24 spec §5，plan Task 4）：
 * - 第六个 trigger「评测」+ Radix 切换 + 六 pane forceMount keep-alive；
 * - eval-tab 组合渲染：运行配置说明文案 + 指标总览 + 趋势卡片壳
 *   （eval-trend-chart 经 next/dynamic 懒加载，jsdom 不可运行 echarts，
 *   整体 mock 断言 props——graph-tab/vector-tab 先例）+ drawer 占位；
 * - 窄面板降档：容器溢出（钉 scrollWidth 模拟）时粒度按钮组收进 ⋯ 菜单
 *   （vector-tab useToolbarTier 溢出检测先例；jsdom 无布局恒 0 档）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";

import { EvalTab } from "@/components/workspace/knowledge/eval-tab";
import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeBase, MetricsOverview, TrendResponse } from "@/core/knowledge/types";

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

const KB: KnowledgeBase = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品资料",
  description: "",
  visibility: "private",
  created_at: "2026-08-09T10:00:00Z",
};

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

function renderTabs(evalPane?: ReactNode) {
  function Harness() {
    const [tab, setTab] = useState<KnowledgeMiddleTab>("documents");
    return (
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <MiddleTabs
          kb={KB}
          activeTab={tab}
          onTabChange={setTab}
          supportedSuffixes={[".md", ".pdf", ".txt"]}
          onUpload={rs.fn()}
          onGenerateWiki={rs.fn()}
          onRenameKb={rs.fn()}
          onDeleteKb={rs.fn()}
          documents={<div data-testid="documents-pane" />}
          wiki={<div data-testid="wiki-pane" />}
          recall={<div data-testid="recall-pane" />}
          vectors={<div data-testid="vectors-pane" />}
          graph={<div data-testid="graph-pane" />}
          eval={evalPane ?? <div data-testid="eval-pane" />}
        />
      </I18nContext.Provider>
    );
  }
  return render(<Harness />);
}

function renderEvalTab(props?: {
  overview?: MetricsOverview | null;
  trend?: TrendResponse | null;
  onGranularityChange?: (granularity: "day" | "week" | "month") => void;
}) {
  const onGranularityChange = props?.onGranularityChange ?? rs.fn();
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <EvalTab
        overview={props?.overview === undefined ? OVERVIEW : props.overview}
        trend={props?.trend === undefined ? TREND : props.trend}
        granularity="day"
        onGranularityChange={onGranularityChange}
      />
    </I18nContext.Provider>,
  );
  return { onGranularityChange };
}

const stateOf = (testid: string) =>
  screen.getByTestId(testid).closest("[data-slot='tabs-content']")?.getAttribute("data-state");

describe("MiddleTabs 评测 tab 挂载", () => {
  beforeEach(() => {
    canvasMock.props = undefined;
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the sixth trigger labeled 评测", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: "评测" })).toBeTruthy();
  });

  it("activates the eval pane on trigger selection (Radix automatic mode)", () => {
    renderTabs();
    // Radix Tabs automatic 激活模式在 mousedown 触发（对齐 graph-tab 先例）。
    fireEvent.mouseDown(screen.getByRole("tab", { name: "评测" }));
    expect(stateOf("eval-pane")).toBe("active");
    expect(stateOf("documents-pane")).toBe("inactive");
  });

  it("keeps all six panes mounted when switching tabs (forceMount)", () => {
    renderTabs();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "评测" }));
    for (const testid of ["documents-pane", "wiki-pane", "recall-pane", "vectors-pane", "graph-pane", "eval-pane"]) {
      expect(screen.getByTestId(testid)).toBeTruthy();
    }
  });
});

describe("EvalTab 组合渲染", () => {
  beforeEach(() => {
    canvasMock.props = undefined;
  });
  afterEach(() => {
    cleanup();
  });

  it("renders run-config note, overview table and trend chart shell", async () => {
    renderEvalTab();
    // 运行配置区：触发按钮落地前仅一行说明文案
    expect(screen.getByTestId("eval-tab").textContent).toContain("CLI");
    // 指标总览
    expect(screen.getByTestId("eval-layer1-table")).toBeTruthy();
    // 趋势卡片壳 + 粒度按钮组（内联档）
    expect(screen.getByText("指标趋势")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "时间粒度" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "日" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "周" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "月" })).toBeTruthy();
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

  it("trend=null 渲染空态提示而非空白画布", async () => {
    renderEvalTab({ trend: null });
    expect(screen.getByText("暂无评测趋势数据")).toBeTruthy();
    expect(screen.queryByTestId("eval-trend-chart-mock")).toBeNull();
    // 给 dynamic import 一个兑现窗口，确认 canvas 不会被加载
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(canvasMock.props).toBeUndefined();
  });

  it("granularity radio click forwards onGranularityChange", () => {
    const { onGranularityChange } = renderEvalTab();
    fireEvent.click(screen.getByRole("radio", { name: "周" }));
    expect(onGranularityChange).toHaveBeenCalledWith("week");
  });

  it("opens the drawer placeholder with the clicked run id (Task 6 replaces with real drawer)", async () => {
    renderEvalTab();
    await screen.findByTestId("eval-trend-chart-mock");
    const onPointClick = canvasMock.props?.onPointClick as ((runId: string) => void) | undefined;
    expect(onPointClick).toBeTypeOf("function");
    act(() => onPointClick?.("run-l1-1"));
    const placeholder = screen.getByTestId("eval-run-drawer-placeholder");
    expect(placeholder.textContent).toContain("run-l1-1");
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
      const { onGranularityChange } = renderEvalTab();
      await screen.findByTestId("eval-trend-chart-mock");
      // 内联粒度按钮组消失，⋯ 按钮出现
      await waitFor(() => {
        expect(screen.queryByRole("radiogroup", { name: "时间粒度" })).toBeNull();
      });
      const more = screen.getByRole("button", { name: "更多选项" });
      // 菜单内承载粒度切换（Radix 键盘开菜单，vector-tab 先例）
      fireEvent.keyDown(more, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("menuitemradio", { name: "月" }));
      expect(onGranularityChange).toHaveBeenCalledWith("month");
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      } else {
        delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });
});
