/**
 * 评测趋势图 option 纯函数（spec 2026-08-24 §4.3/§4.6，plan Task 3）：
 * - 6 条 series：Layer 1 实线实心圆 / Layer 2 虚线空心圆，默认只显示
 *   Recall@k + Hit Rate（图例 selected），其余隐藏防拥挤；
 * - datum 携带 runId（Layer 1 线挂 layer1_run_id，Layer 2 线挂 layer2_run_id），
 *   click 从 params.data 取数、不依赖 dataIndex；
 * - 阈值线 = baseline.recall_at_k - threshold_percent/100；baseline=null 不生成；
 * - 回退点项级 itemStyle 标红由 regression.detected 驱动（per-category 门禁
 *   口径），与阈值线解耦；
 * - y 轴动态下界（数据/阈值线最小值让 0.05、下限 0、上界恒 1）；
 * - 基线更新点（is_baseline_update）画竖线；
 * - tooltip 一律 escapeHtml。
 */
import { describe, expect, it } from "@rstest/core";

import {
  buildChartOption,
  buildTrendTooltipHtml,
  escapeHtml,
  type TrendTooltipParam,
} from "@/components/workspace/knowledge/eval-trend-chart.utils";
import type { TrendChartLabels, TrendPoint, TrendResponse } from "@/core/knowledge/types";

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

function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
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
    ...overrides,
  };
}

const BASELINE: NonNullable<TrendResponse["baseline"]> = {
  recall_at_k: 0.9,
  threshold_percent: 3,
};

interface SeriesLike {
  name: string;
  type: string;
  lineStyle?: { color?: string; type?: string; width?: number };
  symbol?: string;
  data?: { value: [string, number | null]; runId: string | null; itemStyle?: { color?: string } }[];
  markLine?: { silent?: boolean; data: Record<string, unknown>[] };
}

function buildOption(
  points: TrendPoint[],
  baseline: TrendResponse["baseline"] = BASELINE,
  granularity: "day" | "week" | "month" = "day",
) {
  return buildChartOption({ points, granularity, baseline, labels: LABELS, dark: false }) as {
    legend: { data: string[]; selected: Record<string, boolean> };
    yAxis: { min: number; max: number };
    xAxis: { axisLabel: { formatter: string } };
    series: SeriesLike[];
  };
}

describe("buildChartOption 指标线配置", () => {
  it("generates 6 metric series with spec §4.3.2 colors and line styles", () => {
    const option = buildOption([point()]);
    const metric = option.series.filter((s) => !s.markLine);
    expect(metric).toHaveLength(6);

    const byName = new Map(metric.map((s) => [s.name, s]));
    // Layer 1：实线 + 实心圆
    expect(byName.get("Recall@k")?.lineStyle).toMatchObject({ color: "#3B82F6", width: 2 });
    expect(byName.get("Recall@k")?.lineStyle?.type).toBeUndefined();
    expect(byName.get("Recall@k")?.symbol).toBe("circle");
    expect(byName.get("命中率")?.lineStyle).toMatchObject({ color: "#10B981" });
    expect(byName.get("MRR")?.lineStyle).toMatchObject({ color: "#8B5CF6" });
    // Layer 2：虚线 + 空心圆
    expect(byName.get("忠实度")?.lineStyle).toMatchObject({ color: "#F59E0B", type: "dashed" });
    expect(byName.get("忠实度")?.symbol).toBe("emptyCircle");
    expect(byName.get("答案相关性")?.lineStyle).toMatchObject({ color: "#EC4899", type: "dashed" });
    expect(byName.get("上下文精度")?.lineStyle).toMatchObject({ color: "#06B6D4", type: "dashed" });
  });

  it("legend defaults: only Recall@k + Hit Rate visible", () => {
    const option = buildOption([point()]);
    expect(option.legend.data).toEqual([
      "Recall@k",
      "命中率",
      "MRR",
      "忠实度",
      "答案相关性",
      "上下文精度",
    ]);
    expect(option.legend.selected).toEqual({
      "Recall@k": true,
      命中率: true,
      MRR: false,
      忠实度: false,
      答案相关性: false,
      上下文精度: false,
    });
  });

  it("attaches layer1_run_id to Layer 1 series and layer2_run_id to Layer 2 series", () => {
    const option = buildOption([
      point({ layer1_run_id: "l1-a", layer2_run_id: "l2-a" }),
      point({ date: "2026-08-21", layer1_run_id: "l1-b", layer2_run_id: null }),
    ]);
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("Recall@k")?.data?.map((d) => d.runId)).toEqual(["l1-a", "l1-b"]);
    expect(byName.get("MRR")?.data?.map((d) => d.runId)).toEqual(["l1-a", "l1-b"]);
    expect(byName.get("忠实度")?.data?.map((d) => d.runId)).toEqual(["l2-a", null]);
  });

  it("keeps null metric values as gaps (no connectNulls)", () => {
    const option = buildOption([point({ recall_at_k: null, faithfulness: null })]);
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("Recall@k")?.data?.[0]?.value[1]).toBeNull();
    expect(byName.get("忠实度")?.data?.[0]?.value[1]).toBeNull();
    expect((byName.get("Recall@k") as Record<string, unknown> | undefined)?.connectNulls).toBeUndefined();
  });
});

describe("buildChartOption 阈值线与异常标记", () => {
  it("draws threshold line at baseline.recall_at_k - threshold_percent/100", () => {
    const option = buildOption([point()], { recall_at_k: 0.9, threshold_percent: 3 });
    const marker = option.series.find((s) => s.markLine);
    expect(marker).toBeDefined();
    expect(marker?.markLine?.silent).toBe(true);
    const horizontal = marker?.markLine?.data.find((d) => "yAxis" in d);
    expect(horizontal?.yAxis).toBeCloseTo(0.87, 5);
    expect(JSON.stringify(horizontal)).toContain("回退阈值 -3%");
  });

  it("omits the markLine series entirely when baseline is null", () => {
    const option = buildOption([point()], null);
    expect(option.series.filter((s) => s.markLine)).toHaveLength(0);
  });

  it("marks regression points red on the Recall@k series only (per-category gate)", () => {
    const option = buildOption([
      point({ regression: { detected: true, categories: ["global"] } }),
      point({ date: "2026-08-21", regression: { detected: false, categories: [] } }),
    ]);
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("Recall@k")?.data?.[0]?.itemStyle?.color).toBe("#EF4444");
    expect(byName.get("Recall@k")?.data?.[1]?.itemStyle).toBeUndefined();
    // 回退标红只挂 Recall@k（门禁指标），Hit Rate 等其他线不染红
    expect(byName.get("命中率")?.data?.[0]?.itemStyle).toBeUndefined();
  });

  it("draws a vertical markLine for is_baseline_update points", () => {
    const option = buildOption([point({ is_baseline_update: true })]);
    const marker = option.series.find((s) => s.markLine);
    const vertical = marker?.markLine?.data.find((d) => "xAxis" in d);
    expect(vertical?.xAxis).toBe("2026-08-20");
    expect(JSON.stringify(vertical)).toContain("基线更新");
  });

  it("keeps vertical baseline-update lines when threshold is absent", () => {
    // baseline 行存在但被标记运行不在阈值窗口内等边缘情况：竖线仍应出现
    const option = buildOption([point({ is_baseline_update: true })], null);
    const marker = option.series.find((s) => s.markLine);
    expect(marker?.markLine?.data.some((d) => "xAxis" in d && d.xAxis === "2026-08-20")).toBe(true);
  });
});

describe("buildChartOption 坐标轴", () => {
  it("y axis: dynamic lower bound (min of data/threshold minus 0.05), max fixed at 1", () => {
    // 数据最小 0.81（mrr），阈值 0.87 → 0.81-0.05=0.76 → 取整 0.7
    const option = buildOption([point()], { recall_at_k: 0.9, threshold_percent: 3 });
    expect(option.yAxis.min).toBeCloseTo(0.7, 5);
    expect(option.yAxis.max).toBe(1);
  });

  it("y axis lower bound considers the threshold line below all data", () => {
    // 阈值 0.75 低于全部数据 → 0.75-0.05=0.70 → 0.7
    const option = buildOption([point()], { recall_at_k: 0.78, threshold_percent: 3 });
    expect(option.yAxis.min).toBeCloseTo(0.7, 5);
  });

  it("y axis lower bound clamps at 0", () => {
    const option = buildOption([point({ recall_at_k: 0.03, hit_rate: 0.04, mrr: 0.02, faithfulness: null, answer_relevancy: null, context_precision: null })], null);
    expect(option.yAxis.min).toBe(0);
  });

  it("y axis lower bound is 0 when there is no data at all", () => {
    const option = buildOption([point({ recall_at_k: null, hit_rate: null, mrr: null, faithfulness: null, answer_relevancy: null, context_precision: null })], null);
    expect(option.yAxis.min).toBe(0);
  });

  it("x axis label format follows granularity", () => {
    expect(buildOption([point()], BASELINE, "day").xAxis.axisLabel.formatter).toBe("{MM}-{dd}");
    expect(buildOption([point()], BASELINE, "week").xAxis.axisLabel.formatter).toBe("{yyyy}-{MM}");
    expect(buildOption([point()], BASELINE, "month").xAxis.axisLabel.formatter).toBe("{yyyy}-{MM}");
  });

  it("dark mode flips decoration colors (axis label color differs from light)", () => {
    const light = buildOption([point()]);
    const dark = buildChartOption({
      points: [point()],
      granularity: "day",
      baseline: BASELINE,
      labels: LABELS,
      dark: true,
    }) as { xAxis: { axisLabel: { color: string } } };
    expect(dark.xAxis.axisLabel.color).not.toBe(
      (light as unknown as { xAxis: { axisLabel: { color: string } } }).xAxis.axisLabel.color,
    );
  });
});

describe("buildTrendTooltipHtml", () => {
  function paramsFor(points: TrendPoint[], date: string, seriesNames: string[]): TrendTooltipParam[] {
    const byLabel: Record<string, keyof TrendPoint> = {
      "Recall@k": "recall_at_k",
      命中率: "hit_rate",
      MRR: "mrr",
      忠实度: "faithfulness",
      答案相关性: "answer_relevancy",
      上下文精度: "context_precision",
    };
    const p = points.find((pt) => pt.date === date);
    if (!p) throw new Error(`no point at ${date}`);
    return seriesNames.map((name) => {
      const key = byLabel[name] as "recall_at_k";
      return {
        seriesName: name,
        color: "#3B82F6",
        data: {
          value: [p.date, p[key]],
          runId: name === "忠实度" ? p.layer2_run_id : p.layer1_run_id,
          metricKey: key,
        },
      };
    });
  }

  it("renders date header, percent for rate metrics and raw for mrr/ragas", () => {
    const points = [point()];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["Recall@k", "MRR", "忠实度"]), points, LABELS);
    expect(html).toContain("2026-08-20");
    expect(html).toContain("90.0%"); // recall_at_k 0.9 → 百分比
    expect(html).toContain("0.810"); // mrr → 原始三位小数
    expect(html).toContain("0.930"); // faithfulness → 原始三位小数
    expect(html).toContain("点击查看详情");
  });

  it("shows delta arrows against the previous point with the same metric", () => {
    const points = [
      point({ date: "2026-08-19", recall_at_k: 0.923 }),
      point({ date: "2026-08-20", recall_at_k: 0.9 }), // ↓2.3%
    ];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["Recall@k"]), points, LABELS);
    expect(html).toContain("↓2.3%");
    const prev = buildTrendTooltipHtml(paramsFor(points, "2026-08-19", ["Recall@k"]), points, LABELS);
    expect(prev).not.toContain("↑");
    expect(prev).not.toContain("↓");
  });

  it("skips series whose value is null at this date", () => {
    const points = [point({ faithfulness: null })];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["Recall@k", "忠实度"]), points, LABELS);
    expect(html).toContain("Recall@k");
    expect(html).not.toContain("忠实度");
  });

  it("lists regressed categories when regression.detected", () => {
    const points = [point({ regression: { detected: true, categories: ["global", "relation"] } })];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["Recall@k"]), points, LABELS);
    expect(html).toContain("回退题型");
    expect(html).toContain("global");
    expect(html).toContain("relation");
  });

  it("escapes HTML in date, series names and category names", () => {
    const evil: TrendChartLabels = { ...LABELS, recallAtK: "<img src=x onerror=alert(1)>" };
    const points = [point({ date: "2026-08-20<script>", regression: { detected: true, categories: ["<b>global</b>"] } })];
    const html = buildTrendTooltipHtml(
      [
        {
          seriesName: "<img src=x onerror=alert(1)>",
          color: "#3B82F6",
          data: { value: ["2026-08-20<script>", 0.9], runId: "r", metricKey: "recall_at_k" },
        },
      ],
      points,
      evil,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    // 用户输入的 <b>global</b> 必须被转义（tooltip 模板自身的 <b> 数值标签除外）
    expect(html).not.toContain("<b>global</b>");
    expect(html).toContain("&lt;b&gt;global&lt;/b&gt;");
    expect(html).toContain("&lt;img");
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, > and quotes", () => {
    expect(escapeHtml(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });
});
