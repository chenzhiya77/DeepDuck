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

/** 滑条缩放的最少点数（2026-09-05）：点数稀疏时常驻滑条纯噪声，退役。 */
const DATA_ZOOM_MIN_POINTS = 8;
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

/** 趋势图可画的 10 个数值指标键（6 图例 + 4 picker），均为 TrendPoint 的可空数值键。 */
export type TrendMetricKey =
  | "recall_at_k"
  | "hit_rate"
  | "mrr"
  | "path_accuracy"
  | "faithfulness"
  | "answer_relevancy"
  | "context_precision"
  | "citation_precision"
  | "citation_recall"
  | "seed_hit_rate";

/** picker 稀疏指标线定义（spec §4.3）：4 个仅完整档产出的候选，线型沿用 layer 语义。 */
export interface PickerMetricDef {
  key: "path_accuracy" | "citation_precision" | "citation_recall" | "seed_hit_rate";
  labelKey: "pathAccuracy" | "citationPrecision" | "citationRecall" | "seedHitRate";
  color: string;
  /** Layer 1 = 实线实心圆；Layer 2 = 虚线空心圆（与图例六线同语义）。 */
  layer: 1 | 2;
}

/** picker 4 候选（颜色冻结，与图例六色不撞；spec §4.3 + plan Global Constraints）。 */
export const PICKER_METRICS: readonly PickerMetricDef[] = [
  { key: "path_accuracy", labelKey: "pathAccuracy", color: "#84CC16", layer: 1 },
  { key: "citation_precision", labelKey: "citationPrecision", color: "#F97316", layer: 2 },
  { key: "citation_recall", labelKey: "citationRecall", color: "#14B8A6", layer: 2 },
  { key: "seed_hit_rate", labelKey: "seedHitRate", color: "#A855F7", layer: 2 },
];

/** 回退点标红色（regression.detected 驱动，per-category 门禁口径，§4.3.4）。 */
const REGRESSION_COLOR = "#EF4444";

/** datum 携带 runId 与 metricKey——click/tooltip 从 data 取数，不依赖 dataIndex。 */
export interface TrendDatum {
  value: [string, number | null];
  runId: string | null;
  metricKey: TrendMetricKey;
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

/** 数值语言统一（2026-09-05）：全指标百分数 1 位小数——与总览表/瓦片/阈值
 *  芯片同口径；MRR/RAGAS 三位小数退役（PERCENT_KEYS 白名单随之退役）。 */
function formatValue(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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
  pickerSelected?: readonly string[],
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
        const magnitude = `${(Math.abs(delta) * 100).toFixed(1)}%`;
        deltaHtml = ` <span style="opacity:.6">${arrow}${magnitude}</span>`;
        break;
      }
    }
    const color = escapeHtml(param.color ?? "#999");
    const marker =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
      `background:${color};margin-right:4px"></span>`;
    return [
      `${marker}${escapeHtml(param.seriesName)}&nbsp;&nbsp;<b>${formatValue(value)}</b>${deltaHtml}`,
    ];
  });

  // 稀疏语义（spec §4.4）：选中的 picker 指标在该日期为 null（该档未跑）时不进
  // axis params（echarts 只为非空点生成 param）→ 显式补哑行，避免“勾了却无此行”。
  if (point && pickerSelected) {
    for (const key of pickerSelected) {
      const metric = PICKER_METRICS.find((m) => m.key === key);
      if (!metric || point[metric.key] != null) continue;
      const color = escapeHtml(metric.color);
      const marker =
        `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
        `background:${color};margin-right:4px"></span>`;
      rows.push(
        `${marker}${escapeHtml(labels[metric.labelKey])}&nbsp;&nbsp;` +
          `<span style="opacity:.6">${escapeHtml(labels.notRunInTier)}</span>`,
      );
    }
  }

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

/** 当前可见数值指标键（y 轴 seeds 与卡头芯片口径）：图例开启项 ∪ picker 选中项。 */
export function resolveVisibleKeys(
  labels: TrendChartLabels,
  legendSelected: Record<string, boolean> | undefined,
  pickerSelected: readonly string[] | undefined,
): TrendMetricKey[] {
  const fromLegend: TrendMetricKey[] = METRICS.filter((m) => legendSelected?.[labels[m.labelKey]] ?? m.defaultOn).map(
    (m) => m.key,
  );
  const fromPicker: TrendMetricKey[] = PICKER_METRICS.filter((m) => pickerSelected?.includes(m.key)).map((m) => m.key);
  return [...fromLegend, ...fromPicker];
}

const MIN_Y_SPAN = 0.1;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** y 轴自适应（spec §4.6）：seeds = 可见序列值 ∪ 阈值线值；±0.05 padding、10pp
 *  取整、封顶 [0,1]、最小轴程 10pp（不足时以中点对称扩，防高分簇塌成直线）。 */
export function computeYAxisRange(
  points: readonly TrendPoint[],
  baseline: TrendResponse["baseline"],
  visibleKeys: readonly TrendMetricKey[],
): { yMin: number; yMax: number } {
  const thresholdValue = baseline ? baseline.recall_at_k - baseline.threshold_percent / 100 : null;
  const values = points.flatMap((p) => visibleKeys.map((k) => p[k])).filter((v): v is number => v != null);
  const seeds = thresholdValue !== null ? [...values, thresholdValue] : values;
  if (seeds.length === 0) return { yMin: 0, yMax: 1 };
  let yMin = Math.max(0, Math.floor((Math.min(...seeds) - 0.05) * 10) / 10);
  let yMax = Math.min(1, Math.ceil((Math.max(...seeds) + 0.05) * 10) / 10);
  // 守卫：padding+取整已数学上保证 ≥10pp，此处兜底防夹逼/未来公式变更。
  if (yMax - yMin < MIN_Y_SPAN) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - MIN_Y_SPAN / 2;
    yMax = mid + MIN_Y_SPAN / 2;
    if (yMin < 0) {
      yMin = 0;
      yMax = MIN_Y_SPAN;
    } else if (yMax > 1) {
      yMax = 1;
      yMin = 1 - MIN_Y_SPAN;
    }
  }
  return { yMin: round2(yMin), yMax: round2(yMax) };
}

/** 卡头 y 轴范围芯片文案（spec §4.6）：yMin>0（轴不从 0 起）时经 format 出
 *  "Y轴 xx%–yy%"；yMin<=0 返回 null（不显芯片，避免被误读成从 0 起）。 */
export function buildYAxisRangeLabel(
  points: readonly TrendPoint[],
  baseline: TrendResponse["baseline"],
  visibleKeys: readonly TrendMetricKey[],
  format: (minPercent: number, maxPercent: number) => string,
): string | null {
  const { yMin, yMax } = computeYAxisRange(points, baseline, visibleKeys);
  if (yMin <= 0) return null;
  return format(Math.round(yMin * 100), Math.round(yMax * 100));
}

export function buildChartOption(input: {
  points: TrendPoint[];
  granularity: TrendResponse["granularity"];
  baseline: TrendResponse["baseline"];
  labels: TrendChartLabels;
  dark?: boolean;
  /** picker 选中的稀疏指标键（会话级）——条件并入 series，不进图例。 */
  pickerSelected?: readonly string[];
  /** 图例开关回流态（echarts legendselectchanged）——驱动 y 轴按可见集自适应。 */
  legendSelected?: Record<string, boolean>;
}): EChartsCoreOption {
  const { points, granularity, baseline, labels, dark = false, pickerSelected, legendSelected } = input;
  const thresholdValue = baseline ? baseline.recall_at_k - baseline.threshold_percent / 100 : null;

  // y 轴随可见序列自适应（spec §4.6）：可见集 = 图例开启项 ∪ picker 选中项。
  const visibleKeys = resolveVisibleKeys(labels, legendSelected, pickerSelected);
  const { yMin, yMax } = computeYAxisRange(points, baseline, visibleKeys);

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

  // picker 稀疏系列（spec §4.3）：仅选中的候选并入，线型沿用 layer 语义（L1 实线
  // 实心圆 / L2 虚线空心圆）。不进 legend.data——picker 是独立多选入口，与图例六线
  // 的 defaultOn 开关语义分离，避免两处控制同一系列显隐。
  const pickerSeries: LineSeriesOption[] = PICKER_METRICS.filter((m) => pickerSelected?.includes(m.key)).map(
    (metric) => ({
      name: labels[metric.labelKey],
      type: "line",
      data: points.map((p): TrendDatum => ({
        value: [p.date, p[metric.key]],
        runId: metric.layer === 1 ? p.layer1_run_id : p.layer2_run_id,
        metricKey: metric.key,
      })),
      lineStyle:
        metric.layer === 1
          ? { color: metric.color, width: 2 }
          : { color: metric.color, width: 2, type: "dashed" },
      itemStyle: { color: metric.color },
      symbol: metric.layer === 1 ? "circle" : "emptyCircle",
      symbolSize: 6,
      emphasis: { scale: 1.5 },
    }),
  );

  // 标记系列：阈值横线（silent 不吃点击，避免 dataIndex 歧义）+ 基线更新竖线。
  // 系列名不进 legend.data，不出现在图例。baseline=null 且无基线更新点时不生成。
  const baselineDates = points.filter((p) => p.is_baseline_update).map((p) => p.date);
  const markLineData: Record<string, unknown>[] = [];
  if (thresholdValue !== null && baseline) {
    // 阈值红虚线保留，但线上文字标注退役（2026-09-05）：insideEndTop 贴右端
    // 与贴顶的数据线重叠压线——文案改由 eval-tab 头部行红芯片承载。
    markLineData.push({
      yAxis: thresholdValue,
      lineStyle: { color: REGRESSION_COLOR, type: "dashed", width: 1 },
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
    // 滑条退役时底部只留图例高度（2026-09-05），不留滑条空槽。
    grid: { left: 60, right: 40, top: 40, bottom: points.length > DATA_ZOOM_MIN_POINTS ? 60 : 40 },
    legend: {
      data: METRICS.map((m) => labels[m.labelKey]),
      bottom: 0,
      selected: Object.fromEntries(
        METRICS.map((m) => [labels[m.labelKey], legendSelected?.[labels[m.labelKey]] ?? m.defaultOn]),
      ),
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
      max: yMax,
      axisLabel: {
        formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        color: ink(0.55, dark),
      },
      splitLine: { lineStyle: { type: "dashed", color: ink(dark ? 0.1 : 0.06, dark) } },
    },
    series: [...metricSeries, ...pickerSeries, ...markerSeries],
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: dark ? "rgba(24,24,30,0.85)" : "rgba(255,255,255,0.9)",
      borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
      textStyle: { fontSize: 11, color: ink(0.85, dark) },
      formatter: (params: unknown) =>
        buildTrendTooltipHtml(params as TrendTooltipParam[], points, labels, pickerSelected),
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      ...(points.length > DATA_ZOOM_MIN_POINTS
        ? [{ type: "slider" as const, xAxisIndex: 0, height: 20, bottom: 30 }]
        : []),
    ],
  };
}
