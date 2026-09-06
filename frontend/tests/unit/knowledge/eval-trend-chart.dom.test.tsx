/**
 * 评测趋势图 canvas 组件（spec 2026-08-24 §4，plan Task 3）：
 * jsdom 不可运行 echarts——mock echarts/core 适配层（对齐 graph-tab.dom.test
 * 的 canvas mock 基建），断言：
 * - props（points/granularity/baseline/labels）经 buildChartOption 透传进
 *   setOption；
 * - 点击事件从 datum.runId 取数（不依赖 dataIndex——阈值线/多 series 下索引
 *   不对齐），无 runId 的点击（markLine 等）不触发回调。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import EvalTrendChart from "@/components/workspace/knowledge/eval-trend-chart";
import type { TrendChartLabels, TrendPoint, TrendResponse } from "@/core/knowledge/types";

/** echarts 适配层 mock：捕获 setOption 入参与事件处理器，不碰真实 canvas。 */
const echartsMock = rs.hoisted(() => {
  const handlers = new Map<string, ((params: unknown) => void)[]>();
  return {
    handlers,
    setOptionCalls: [] as { option: Record<string, unknown>; opts?: unknown }[],
    use: rs.fn(),
    init: rs.fn(() => ({
      on: (event: string, cb: (params: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      },
      setOption: (option: Record<string, unknown>, opts?: unknown) => {
        echartsMock.setOptionCalls.push({ option, opts });
      },
      resize: rs.fn(),
      dispose: rs.fn(),
    })),
  };
});

rs.mock("echarts/core", () => echartsMock);

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

const LABELS: TrendChartLabels = {
  recallAtK: "Recall@k",
  hitRate: "命中率",
  mrr: "MRR",
  faithfulness: "忠实度",
  answerRelevancy: "答案相关性",
  contextPrecision: "上下文精度",
  thresholdLine: "回退阈值线",
  thresholdLabel: (p) => `回退阈值 -${p}%`,
  baselineUpdate: "基线更新",
  clickForDetail: "点击查看详情",
  regressionPrefix: "回退题型",
};

const POINTS: TrendPoint[] = [
  {
    date: "2026-08-20",
    recall_at_k: 0.9,
    hit_rate: 0.92,
    mrr: 0.81,
    path_accuracy: 0.95,
    faithfulness: 0.93,
    answer_relevancy: 0.87,
    context_precision: 0.85,
    citation_precision: 0.9,
    citation_recall: 0.85,
    seed_hit_rate: 0.8,
    layer1_run_id: "run-l1-1",
    layer2_run_id: "run-l2-1",
    regression: null,
    is_baseline_update: false,
  },
];

const BASELINE: NonNullable<TrendResponse["baseline"]> = {
  recall_at_k: 0.9,
  threshold_percent: 3,
};

interface SeriesLike {
  name: string;
  data?: { value: [string, number | null]; runId: string | null }[];
  markLine?: { data: Record<string, unknown>[] };
}

function lastOption() {
  const call = echartsMock.setOptionCalls.at(-1);
  if (!call) throw new Error("setOption was not called");
  return call.option as {
    legend: { selected: Record<string, boolean> };
    xAxis: { axisLabel: { formatter: string } };
    series: SeriesLike[];
  };
}

describe("EvalTrendChart", () => {
  beforeEach(() => {
    echartsMock.setOptionCalls.length = 0;
    echartsMock.handlers.clear();
    echartsMock.init.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the container and inits echarts once", () => {
    render(
      <EvalTrendChart points={POINTS} granularity="day" baseline={BASELINE} labels={LABELS} />,
    );
    expect(screen.getByTestId("eval-trend-chart")).toBeTruthy();
    expect(echartsMock.init).toHaveBeenCalledTimes(1);
    expect(echartsMock.setOptionCalls.length).toBeGreaterThan(0);
  });

  it("passes props through into the chart option (series, legend, threshold)", () => {
    render(
      <EvalTrendChart points={POINTS} granularity="day" baseline={BASELINE} labels={LABELS} />,
    );
    const option = lastOption();
    // 6 条指标线 + 1 条阈值线系列
    expect(option.series).toHaveLength(7);
    const recall = option.series.find((s) => s.name === "Recall@k");
    expect(recall?.data?.[0]?.runId).toBe("run-l1-1");
    expect(recall?.data?.[0]?.value).toEqual(["2026-08-20", 0.9]);
    // 图例默认显隐：Recall@k + 命中率 开，其余关
    expect(option.legend.selected).toMatchObject({ "Recall@k": true, 命中率: true, MRR: false });
    // 阈值线 = 0.9 - 3/100
    const marker = option.series.find((s) => s.markLine);
    expect(marker?.markLine?.data.some((d) => "yAxis" in d && Number(d.yAxis) === 0.87)).toBe(true);
    // 粒度透传到 x 轴日期格式
    expect(option.xAxis.axisLabel.formatter).toBe("{MM}-{dd}");
  });

  it("baseline=null 时不生成阈值线系列", () => {
    render(<EvalTrendChart points={POINTS} granularity="week" baseline={null} labels={LABELS} />);
    const option = lastOption();
    expect(option.series.filter((s) => s.markLine)).toHaveLength(0);
    expect(option.xAxis.axisLabel.formatter).toBe("{yyyy}-{MM}");
  });

  it("click on a datum with runId fires onPointClick; runId-less clicks do not", () => {
    const onPointClick = rs.fn();
    render(
      <EvalTrendChart
        points={POINTS}
        granularity="day"
        baseline={BASELINE}
        labels={LABELS}
        onPointClick={onPointClick}
      />,
    );
    const clickHandlers = echartsMock.handlers.get("click") ?? [];
    expect(clickHandlers.length).toBeGreaterThan(0);
    // 数据点：datum 携带 runId → 回调
    clickHandlers.forEach((cb) => cb({ data: { value: ["2026-08-20", 0.9], runId: "run-l1-1" } }));
    expect(onPointClick).toHaveBeenCalledWith("run-l1-1");
    // 阈值线等无 runId 的点击 → 不回调（silent 之外的防御）
    onPointClick.mockClear();
    clickHandlers.forEach((cb) => cb({ data: { value: ["2026-08-20", 0.87] } }));
    clickHandlers.forEach((cb) => cb({ componentType: "markLine" }));
    expect(onPointClick).not.toHaveBeenCalled();
  });

  it("re-setOption when points change (merge mode keeps chart state)", () => {
    const { rerender } = render(
      <EvalTrendChart points={POINTS} granularity="day" baseline={BASELINE} labels={LABELS} />,
    );
    const before = echartsMock.setOptionCalls.length;
    const next = [
      ...POINTS,
      { ...POINTS[0]!, date: "2026-08-21", layer1_run_id: "run-l1-2" },
    ];
    rerender(<EvalTrendChart points={next} granularity="day" baseline={BASELINE} labels={LABELS} />);
    expect(echartsMock.setOptionCalls.length).toBeGreaterThan(before);
    const option = lastOption();
    const recall = option.series.find((s) => s.name === "Recall@k");
    expect(recall?.data).toHaveLength(2);
    expect(recall?.data?.[1]?.runId).toBe("run-l1-2");
  });
});
