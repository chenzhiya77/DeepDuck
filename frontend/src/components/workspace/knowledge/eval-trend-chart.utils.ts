/**
 * 评测趋势图 option 组装纯函数（2026-08-24 spec §4.3/§4.6，plan Task 3）。
 * 不 import echarts 运行时，只用类型（对齐 graph-utils.ts 先例）——jsdom 可直测。
 *
 * 冻结取舍（spec §4.1）：趋势图只上 6 条线——Layer 1 三指标（实线 = 确定性、
 * 进 CI 门禁）+ RAGAS 三指标（虚线 = 概率性、只报告）；context_recall 与
 * context_precision 同族同向故省略，架构专属指标入口在总览卡片与 drawer。
 */
import type { LineSeriesOption } from "echarts/charts";
import type { EChartsCoreOption } from "echarts/core";

import type { TrendChartLabels, TrendPoint, TrendResponse } from "@/core/knowledge/types";

/** 指标线定义表（颜色/线型/默认显隐按 spec §4.3.2 冻结，实施时不得变更）。 */
interface MetricDef {
  key:
    | "recall_at_k"
    | "hit_rate"
    | "mrr"
    | "faithfulness"
    | "answer_relevancy"
    | "context_precision";
  labelKey:
    | "recallAtK"
    | "hitRate"
    | "mrr"
    | "faithfulness"
    | "answerRelevancy"
    | "contextPrecision";
  color: string;
  /** Layer 1 = 实线实心圆（硬约束）；Layer 2 = 虚线空心圆（judge 方差，参考）。 */
  layer: 1 | 2;
  /** 默认只显示 Recall@k + Hit Rate，其余经图例点击开启（防拥挤）。 */
  defaultOn: boolean;
}

const METRICS: readonly MetricDef[] = [
  { key: "recall_at_k", labelKey: "recallAtK", color: "#3B82F6", layer: 1, defaultOn: true },
  { key: "hit_rate", labelKey: "hitRate", color: "#10B981", layer: 1, defaultOn: true },
  { key: "mrr", labelKey: "mrr", color: "#8B5CF6", layer: 1, defaultOn: false },
  { key: "faithfulness", labelKey: "faithfulness", color: "#F59E0B", layer: 2, defaultOn: false },
  { key: "answer_relevancy", labelKey: "answerRelevancy", color: "#EC4899", layer: 2, defaultOn: false },
  { key: "context_precision", labelKey: "contextPrecision", color: "#06B6D4", layer: 2, defaultOn: false },
];

/** 回退点标红色（regression.detected 驱动，per-category 门禁口径，§4.3.4）。 */
const REGRESSION_COLOR = "#EF4444";

/** 率类指标用百分比显示；MRR/RAGAS 用原始三位小数（spec §4.4 tooltip 模板）。 */
const PERCENT_KEYS: ReadonlySet<MetricDef["key"]> = new Set(["recall_at_k", "hit_rate"]);

/** datum 携带 runId 与 metricKey——click/tooltip 从 data 取数，不依赖 dataIndex。 */
export interface TrendDatum {
  value: [string, number | null];
  runId: string | null;
  metricKey: MetricDef["key"];
  /** 回退点项级覆写（仅 Recall@k 线）。 */
  itemStyle?: { color: string };
}

export interface TrendTooltipParam {
  seriesName?: string;
  color?: string;
  data?: TrendDatum;
}

/** 墨色：浅色主题用深灰，暗色主题翻成亮灰（vector-canvas ink() 先例）。 */
function ink(alpha: number, dark: boolean): string {
  return dark ? `rgba(235,238,245,${alpha})` : `rgba(60,60,60,${alpha})`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatValue(key: MetricDef["key"], value: number): string {
  return PERCENT_KEYS.has(key) ? `${(value * 100).toFixed(1)}%` : value.toFixed(3);
}

/**
 * tooltip HTML（axis trigger，自定义模板 §4.4）：日期头 + 各指标值与环比箭头
 * （delta 对比同指标上一个非空点）+ 回退题型列表 + 点击提示。插值一律
 * escapeHtml（vector-canvas 先例），防 tooltip HTML 注入。
 */
export function buildTrendTooltipHtml(
  params: TrendTooltipParam[],
  points: readonly TrendPoint[],
  labels: TrendChartLabels,
): string {
  const first = params.find((param) => param.data)?.data;
  if (!first) return "";
  const date = first.value[0];
  const pointIndex = points.findIndex((p) => p.date === date);
  const point = pointIndex >= 0 ? points[pointIndex] : undefined;

  const rows = params.flatMap((param) => {
    const datum = param.data;
    const value = datum?.value[1];
    if (!datum || value == null || !param.seriesName) return [];
    const key = datum.metricKey;
    // 环比：同指标上一个非空点（缺口不参与差值，保持「真实运行」语义）。
    let deltaHtml = "";
    for (let i = pointIndex - 1; i >= 0; i -= 1) {
      const prev = points[i]?.[key];
      if (prev != null) {
        const delta = value - prev;
        const arrow = delta >= 0 ? "↑" : "↓";
        const magnitude = PERCENT_KEYS.has(key)
          ? `${(Math.abs(delta) * 100).toFixed(1)}%`
          : Math.abs(delta).toFixed(3);
        deltaHtml = ` <span style="opacity:.6">${arrow}${magnitude}</span>`;
        break;
      }
    }
    const color = escapeHtml(param.color ?? "#999");
    const marker =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
      `background:${color};margin-right:4px"></span>`;
    return [
      `${marker}${escapeHtml(param.seriesName)}&nbsp;&nbsp;<b>${formatValue(key, value)}</b>${deltaHtml}`,
    ];
  });

  const lines = [`<div style="font-weight:600;margin-bottom:2px">${escapeHtml(date)}</div>`, ...rows];
  if (point?.regression?.detected && point.regression.categories.length > 0) {
    lines.push(
      `<div style="margin-top:2px;color:${REGRESSION_COLOR}">` +
        `${escapeHtml(labels.regressionPrefix)}: ` +
        `${point.regression.categories.map(escapeHtml).join(", ")}</div>`,
    );
  }
  lines.push(`<div style="opacity:.6;margin-top:2px">${escapeHtml(labels.clickForDetail)} →</div>`);
  return lines.join("<br/>");
}

export function buildChartOption(input: {
  points: TrendPoint[];
  granularity: TrendResponse["granularity"];
  baseline: TrendResponse["baseline"];
  labels: TrendChartLabels;
  dark?: boolean;
}): EChartsCoreOption {
  const { points, granularity, baseline, labels, dark = false } = input;
  const thresholdValue = baseline ? baseline.recall_at_k - baseline.threshold_percent / 100 : null;

  // y 轴下界动态：取数据与阈值线的较低者再让 0.05，下限 0；上界恒 1（§4.6）。
  const allValues = points
    .flatMap((p) => METRICS.map((m) => p[m.key]))
    .filter((v): v is number => v !== null);
  const seeds = thresholdValue !== null ? [...allValues, thresholdValue] : allValues;
  const yMin =
    seeds.length === 0 ? 0 : Math.max(0, Math.floor((Math.min(...seeds) - 0.05) * 10) / 10);

  const metricSeries: LineSeriesOption[] = METRICS.map((metric) => ({
    name: labels[metric.labelKey],
    type: "line",
    data: points.map((p): TrendDatum => {
      const datum: TrendDatum = {
        value: [p.date, p[metric.key]],
        runId: metric.layer === 1 ? p.layer1_run_id : p.layer2_run_id,
        metricKey: metric.key,
      };
      // 回退标红只挂 Recall@k（CI 门禁指标）——由 regression.detected 驱动，
      // 与阈值线解耦（「线未破但点红」= category 级回退，§4.3.3 语义边界）。
      if (metric.key === "recall_at_k" && p.regression?.detected) {
        datum.itemStyle = { color: REGRESSION_COLOR };
      }
      return datum;
    }),
    lineStyle:
      metric.layer === 1
        ? { color: metric.color, width: 2 }
        : { color: metric.color, width: 2, type: "dashed" },
    itemStyle: { color: metric.color },
    symbol: metric.layer === 1 ? "circle" : "emptyCircle",
    symbolSize: 6,
    emphasis: { scale: 1.5 },
  }));

  // 标记系列：阈值横线（silent 不吃点击，避免 dataIndex 歧义）+ 基线更新竖线。
  // 系列名不进 legend.data，不出现在图例。baseline=null 且无基线更新点时不生成。
  const baselineDates = points.filter((p) => p.is_baseline_update).map((p) => p.date);
  const markLineData: Record<string, unknown>[] = [];
  if (thresholdValue !== null && baseline) {
    markLineData.push({
      yAxis: thresholdValue,
      lineStyle: { color: REGRESSION_COLOR, type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: labels.thresholdLabel(baseline.threshold_percent),
        color: REGRESSION_COLOR,
        fontSize: 11,
      },
    });
  }
  for (const date of baselineDates) {
    markLineData.push({
      xAxis: date,
      lineStyle: { color: ink(0.45, dark), type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: labels.baselineUpdate,
        color: ink(0.55, dark),
        fontSize: 11,
      },
    });
  }
  const markerSeries: LineSeriesOption[] =
    markLineData.length > 0
      ? [
          {
            name: labels.thresholdLine,
            type: "line",
            data: [],
            silent: true,
            markLine: { silent: true, symbol: "none", data: markLineData },
          },
        ]
      : [];

  return {
    grid: { left: 60, right: 40, top: 40, bottom: 60 },
    legend: {
      data: METRICS.map((m) => labels[m.labelKey]),
      bottom: 0,
      selected: Object.fromEntries(METRICS.map((m) => [labels[m.labelKey], m.defaultOn])),
      textStyle: { color: ink(0.75, dark) },
    },
    xAxis: {
      type: "time",
      axisLabel: {
        formatter: granularity === "day" ? "{MM}-{dd}" : "{yyyy}-{MM}",
        color: ink(0.55, dark),
      },
      axisLine: { lineStyle: { color: ink(0.3, dark) } },
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: 1,
      axisLabel: {
        formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        color: ink(0.55, dark),
      },
      splitLine: { lineStyle: { type: "dashed", color: ink(dark ? 0.1 : 0.06, dark) } },
    },
    series: [...metricSeries, ...markerSeries],
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: dark ? "rgba(24,24,30,0.85)" : "rgba(255,255,255,0.9)",
      borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
      textStyle: { fontSize: 11, color: ink(0.85, dark) },
      formatter: (params: unknown) =>
        buildTrendTooltipHtml(params as TrendTooltipParam[], points, labels),
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      { type: "slider", xAxisIndex: 0, height: 20, bottom: 30 },
    ],
  };
}
