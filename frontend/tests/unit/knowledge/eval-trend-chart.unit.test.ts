/**
 * 评测趋势图 option 纯函数（spec 2026-08-24 §4.3/§4.6，plan Task 3）：
 * - 6 条图例 series（Layer 1 实线实心圆 / Layer 2 虚线空心圆，默认只显示
 *   Recall@k + Hit Rate）+ 经 picker 条件并入的 4 条稀疏指标线（不进图例）；
 * - datum 携带 runId（Layer 1 线挂 layer1_run_id，Layer 2 线挂 layer2_run_id），
 *   click 从 params.data 取数、不依赖 dataIndex；
 * - 阈值线 = baseline.recall_at_k - threshold_percent/100；baseline=null 不生成；
 * - 回退点项级 itemStyle 标红由 regression.detected 驱动（per-category 门禁
 *   口径），与阈值线解耦；
 * - y 轴随可见序列自适应（seeds = 可见值 ∪ 阈值线，±0.05、最小轴程 10pp、封顶 1）；
 * - 基线更新点（is_baseline_update）画竖线；
 * - tooltip 一律 escapeHtml。
 */
import { describe, expect, it } from "@rstest/core";

import {
  buildChartOption,
  buildTrendTooltipHtml,
  buildYAxisRangeLabel,
  escapeHtml,
  PICKER_METRICS,
  type TrendTooltipParam,
} from "@/components/workspace/knowledge/eval-trend-chart.utils";
import type { TrendChartLabels, TrendPoint, TrendResponse } from "@/core/knowledge/types";

const LABELS: TrendChartLabels = {
  recallAtK: "召回率@k",
  hitRate: "命中率",
  mrr: "MRR",
  faithfulness: "忠实度",
  answerRelevancy: "相关性",
  contextPrecision: "精确率",
  pathAccuracy: "路径准确率",
  citationPrecision: "引用准确率",
  citationRecall: "引用召回率",
  seedHitRate: "实体命中率",
  thresholdLine: "回退阈值线",
  thresholdLabel: (p) => `回退阈值 -${p}%`,
  baselineUpdate: "基线更新",
  clickForDetail: "点击查看详情",
  regressionPrefix: "回退题型",
  notRunInTier: "该档未跑",
};

function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
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
  extra: { pickerSelected?: string[]; legendSelected?: Record<string, boolean> } = {},
) {
  return buildChartOption({ points, granularity, baseline, labels: LABELS, dark: false, ...extra }) as {
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
    expect(byName.get("召回率@k")?.lineStyle).toMatchObject({ color: "#3B82F6", width: 2 });
    expect(byName.get("召回率@k")?.lineStyle?.type).toBeUndefined();
    expect(byName.get("召回率@k")?.symbol).toBe("circle");
    expect(byName.get("命中率")?.lineStyle).toMatchObject({ color: "#10B981" });
    expect(byName.get("MRR")?.lineStyle).toMatchObject({ color: "#8B5CF6" });
    // Layer 2：虚线 + 空心圆
    expect(byName.get("忠实度")?.lineStyle).toMatchObject({ color: "#F59E0B", type: "dashed" });
    expect(byName.get("忠实度")?.symbol).toBe("emptyCircle");
    expect(byName.get("相关性")?.lineStyle).toMatchObject({ color: "#EC4899", type: "dashed" });
    expect(byName.get("精确率")?.lineStyle).toMatchObject({ color: "#06B6D4", type: "dashed" });
  });

  it("legend defaults: only Recall@k + Hit Rate visible", () => {
    const option = buildOption([point()]);
    expect(option.legend.data).toEqual([
      "召回率@k",
      "命中率",
      "MRR",
      "忠实度",
      "相关性",
      "精确率",
    ]);
    expect(option.legend.selected).toEqual({
      "召回率@k": true,
      命中率: true,
      MRR: false,
      忠实度: false,
      相关性: false,
      精确率: false,
    });
  });

  it("hides the slider dataZoom when points are sparse (2026-09-05)", () => {
    // 点数稀疏（≤8）时常驻滑条纯噪声：只留 inside 缩放，grid 底部不留滑条空槽。
    const sparse = buildChartOption({
      points: [point()],
      granularity: "day",
      baseline: BASELINE,
      labels: LABELS,
    }) as { dataZoom: { type: string }[]; grid: { bottom: number } };
    expect(sparse.dataZoom.map((d) => d.type)).toEqual(["inside"]);
    expect(sparse.grid.bottom).toBe(40);
    // 点数充足时滑条回归。
    const dense = buildChartOption({
      points: Array.from({ length: 9 }, (_, i) => point({ date: `2026-08-${10 + i}` })),
      granularity: "day",
      baseline: BASELINE,
      labels: LABELS,
    }) as { dataZoom: { type: string }[]; grid: { bottom: number } };
    expect(dense.dataZoom.map((d) => d.type)).toContain("slider");
    expect(dense.grid.bottom).toBe(60);
  });

  it("attaches layer1_run_id to Layer 1 series and layer2_run_id to Layer 2 series", () => {
    const option = buildOption([
      point({ layer1_run_id: "l1-a", layer2_run_id: "l2-a" }),
      point({ date: "2026-08-21", layer1_run_id: "l1-b", layer2_run_id: null }),
    ]);
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("召回率@k")?.data?.map((d) => d.runId)).toEqual(["l1-a", "l1-b"]);
    expect(byName.get("MRR")?.data?.map((d) => d.runId)).toEqual(["l1-a", "l1-b"]);
    expect(byName.get("忠实度")?.data?.map((d) => d.runId)).toEqual(["l2-a", null]);
  });

  it("keeps null metric values as gaps (no connectNulls)", () => {
    const option = buildOption([point({ recall_at_k: null, faithfulness: null })]);
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("召回率@k")?.data?.[0]?.value[1]).toBeNull();
    expect(byName.get("忠实度")?.data?.[0]?.value[1]).toBeNull();
    expect((byName.get("召回率@k") as Record<string, unknown> | undefined)?.connectNulls).toBeUndefined();
  });
});

describe("buildChartOption picker 稀疏指标线（spec §4.3，plan Task 4）", () => {
  it("PICKER_METRICS 冻结 4 个稀疏候选与 spec 色/层", () => {
    expect(PICKER_METRICS.map((m) => m.key)).toEqual([
      "path_accuracy",
      "citation_precision",
      "citation_recall",
      "seed_hit_rate",
    ]);
    const byKey = new Map(PICKER_METRICS.map((m) => [m.key, m]));
    expect(byKey.get("path_accuracy")).toMatchObject({ color: "#84CC16", layer: 1 });
    expect(byKey.get("citation_precision")).toMatchObject({ color: "#F97316", layer: 2 });
    expect(byKey.get("citation_recall")).toMatchObject({ color: "#14B8A6", layer: 2 });
    expect(byKey.get("seed_hit_rate")).toMatchObject({ color: "#A855F7", layer: 2 });
  });

  it("仅在选中时并入 picker 系列，且不进 legend.data（不脏图例）", () => {
    const without = buildOption([point()]);
    expect(without.series.filter((s) => !s.markLine).map((s) => s.name)).not.toContain("引用准确率");
    expect(without.legend.data).toHaveLength(6);

    const withPicker = buildOption([point()], BASELINE, "day", { pickerSelected: ["citation_precision"] });
    const names = withPicker.series.filter((s) => !s.markLine).map((s) => s.name);
    expect(names).toContain("引用准确率");
    // picker 系列不进 legend.data / legend.selected
    expect(withPicker.legend.data).not.toContain("引用准确率");
    expect(withPicker.legend.data).toHaveLength(6);
  });

  it("picker 线型沿用 layer 语义（L1 实线实心 / L2 虚线空心）", () => {
    const option = buildOption([point()], BASELINE, "day", {
      pickerSelected: ["path_accuracy", "citation_precision", "citation_recall", "seed_hit_rate"],
    });
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("路径准确率")?.lineStyle).toMatchObject({ color: "#84CC16", width: 2 });
    expect(byName.get("路径准确率")?.lineStyle?.type).toBeUndefined();
    expect(byName.get("路径准确率")?.symbol).toBe("circle");
    expect(byName.get("引用准确率")?.lineStyle).toMatchObject({ color: "#F97316", type: "dashed" });
    expect(byName.get("引用准确率")?.symbol).toBe("emptyCircle");
    expect(byName.get("引用召回率")?.lineStyle).toMatchObject({ color: "#14B8A6", type: "dashed" });
    expect(byName.get("实体命中率")?.lineStyle).toMatchObject({ color: "#A855F7", type: "dashed" });
  });

  it("picker 系列 runId 按 layer 取源（path_accuracy→L1，引用三→L2）", () => {
    const option = buildOption([point({ layer1_run_id: "l1", layer2_run_id: "l2" })], BASELINE, "day", {
      pickerSelected: ["path_accuracy", "citation_precision"],
    });
    const byName = new Map(option.series.filter((s) => !s.markLine).map((s) => [s.name, s]));
    expect(byName.get("路径准确率")?.data?.[0]?.runId).toBe("l1");
    expect(byName.get("引用准确率")?.data?.[0]?.runId).toBe("l2");
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
    // 线上文字标注退役（2026-09-05）：insideEndTop 贴右端与贴顶数据线重叠
    // 压线——文案改由 eval-tab 头部行红芯片承载（eval-threshold-chip）。
    expect(horizontal?.label).toBeUndefined();
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
    expect(byName.get("召回率@k")?.data?.[0]?.itemStyle?.color).toBe("#EF4444");
    expect(byName.get("召回率@k")?.data?.[1]?.itemStyle).toBeUndefined();
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
  it("y 轴只按可见序列取 seeds：默认隐藏的 mrr 不再把下界拉低", () => {
    // point(): recall 0.9 / hit 0.92 / mrr 0.81（默认隐藏）；阈值 0.87。
    // 可见 = recall + hit + 阈值 → seeds [0.9,0.92,0.87] → yMin 0.8（旧全指标口径会得 0.7）。
    const option = buildOption([point()], { recall_at_k: 0.9, threshold_percent: 3 });
    expect(option.yAxis.min).toBeCloseTo(0.8, 5);
    // 上界自适应：max 0.92 → ceil((0.92+0.05)*10)/10 = 1.0
    expect(option.yAxis.max).toBeCloseTo(1, 5);
  });

  it("开启低值图例项后下界随可见集下探（legendSelected 回流）", () => {
    // mrr 0.81 进可见集 → seeds 加 0.81 → yMin = floor((0.81-0.05)*10)/10 = 0.7
    const option = buildOption([point()], BASELINE, "day", {
      legendSelected: { "召回率@k": true, 命中率: true, MRR: true, 忠实度: false, 相关性: false, 精确率: false },
    });
    expect(option.yAxis.min).toBeCloseTo(0.7, 5);
  });

  it("上界随高分簇自适应下压（不再恒 1）", () => {
    // 可见 recall 0.82 / hit 0.85（无 baseline）→ yMax = ceil((0.85+0.05)*10)/10 = 0.9 < 1
    const option = buildOption([point({ recall_at_k: 0.82, hit_rate: 0.85 })], null);
    expect(option.yAxis.max).toBeCloseTo(0.9, 5);
    expect(option.yAxis.min).toBeCloseTo(0.7, 5);
  });

  it("最小轴程 10pp：全等高分簇不塌成直线（padding+取整保证，守卫兜底）", () => {
    const option = buildOption([point({ recall_at_k: 0.9, hit_rate: 0.9 })], null);
    expect(option.yAxis.max - option.yAxis.min).toBeGreaterThanOrEqual(0.1 - 1e-9);
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
      "召回率@k": "recall_at_k",
      命中率: "hit_rate",
      MRR: "mrr",
      忠实度: "faithfulness",
      相关性: "answer_relevancy",
      精确率: "context_precision",
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

  it("renders date header and percent for every metric (unified numeric language, 2026-09-05)", () => {
    const points = [point()];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["召回率@k", "MRR", "忠实度"]), points, LABELS);
    expect(html).toContain("2026-08-20");
    expect(html).toContain("90.0%"); // recall_at_k 0.9
    expect(html).toContain("81.0%"); // mrr 0.81 → 百分数（三位小数退役）
    expect(html).toContain("93.0%"); // faithfulness 0.93 → 百分数
    expect(html).toContain("点击查看详情");
  });

  it("shows delta arrows against the previous point with the same metric", () => {
    const points = [
      point({ date: "2026-08-19", recall_at_k: 0.923 }),
      point({ date: "2026-08-20", recall_at_k: 0.9 }), // ↓2.3%
    ];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["召回率@k"]), points, LABELS);
    expect(html).toContain("↓2.3%");
    const prev = buildTrendTooltipHtml(paramsFor(points, "2026-08-19", ["召回率@k"]), points, LABELS);
    expect(prev).not.toContain("↑");
    expect(prev).not.toContain("↓");
  });

  it("skips series whose value is null at this date", () => {
    const points = [point({ faithfulness: null })];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["召回率@k", "忠实度"]), points, LABELS);
    expect(html).toContain("召回率@k");
    expect(html).not.toContain("忠实度");
  });

  it("为选中但 null 的 picker 指标补‘该档未跑’哑行（spec §4.4）", () => {
    const points = [point({ citation_precision: null })];
    const html = buildTrendTooltipHtml(
      paramsFor(points, "2026-08-20", ["召回率@k"]),
      points,
      LABELS,
      ["citation_precision"],
    );
    expect(html).toContain("引用准确率");
    expect(html).toContain("该档未跑");
  });

  it("选中 picker 指标有值时不补哑行（由 echarts 正常入 params）", () => {
    const points = [point({ citation_precision: 0.9 })];
    const html = buildTrendTooltipHtml(
      paramsFor(points, "2026-08-20", ["召回率@k"]),
      points,
      LABELS,
      ["citation_precision"],
    );
    expect(html).not.toContain("该档未跑");
  });

  it("lists regressed categories when regression.detected", () => {
    const points = [point({ regression: { detected: true, categories: ["global", "relation"] } })];
    const html = buildTrendTooltipHtml(paramsFor(points, "2026-08-20", ["召回率@k"]), points, LABELS);
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

describe("buildYAxisRangeLabel（卡头 y 轴芯片，spec §4.6）", () => {
  const fmt = (min: number, max: number) => `Y轴 ${min}%–${max}%`;

  it("yMin>0 时返回范围文案（诚实提示轴不从 0 起）", () => {
    // 可见 recall 0.9 + hit 0.92 + 阈值 0.87 → yMin 0.8 / yMax 1.0
    expect(buildYAxisRangeLabel([point()], BASELINE, ["recall_at_k", "hit_rate"], fmt)).toBe("Y轴 80%–100%");
  });

  it("yMin=0（轴从 0 起）时返回 null——不显芯片", () => {
    expect(
      buildYAxisRangeLabel([point({ recall_at_k: 0.03, hit_rate: 0.04 })], null, ["recall_at_k", "hit_rate"], fmt),
    ).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, > and quotes", () => {
    expect(escapeHtml(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });
});
