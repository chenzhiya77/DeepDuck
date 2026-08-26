"use client";

/**
 * 指标趋势画布（2026-08-24 spec §4，plan Task 3）：echarts 手写适配层。
 * 经 next/dynamic(ssr:false) 由 eval-tab 懒加载——不进首屏 chunk（对齐
 * vector-tab 挂载 vector-canvas 的先例）。
 * 纯渲染组件：不 fetch、不调 useI18n——数据与文案（labels）经 props 注入；
 * option 组装在 eval-trend-chart.utils.ts 纯函数（jsdom 可测，graph-utils 先例）。
 * jsdom 不可运行 echarts，DOM 测试中 mock echarts/core 适配层。
 */
import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import type { TrendChartLabels, TrendPoint, TrendResponse } from "@/core/knowledge/types";

import { buildChartOption } from "./eval-trend-chart.utils";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export interface EvalTrendChartProps {
  points: TrendPoint[];
  granularity: TrendResponse["granularity"];
  baseline: TrendResponse["baseline"];
  /** i18n 文案包（eval-tab 注入；保持本组件纯渲染）。 */
  labels: TrendChartLabels;
  onPointClick?: (runId: string) => void;
}

/** 当前是否暗色主题（next-themes 在 <html> 上挂 .dark class）。 */
function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function EvalTrendChart({
  points,
  granularity,
  baseline,
  labels,
  onPointClick,
}: EvalTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  // 回调经 ref 穿透，避免 identity 变化触发 setOption（vector-canvas 先例）。
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;
  // 主题重建读取最新 props：init effect 只跑一次，闭包捕获会过期。
  const argsRef = useRef({ points, granularity, baseline, labels });
  argsRef.current = { points, granularity, baseline, labels };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;
    chart.on("click", (params) => {
      // 从 datum 取 runId——不依赖 dataIndex（多 series / markLine 下索引不对齐）。
      const runId = (params as { data?: { runId?: string } }).data?.runId;
      if (runId) clickRef.current?.(runId);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    // 主题切换（<html> .dark）→ 全量重建（轴/图例/tooltip 等装饰层主题感知）。
    const themeObserver = new MutationObserver(() => {
      chart.setOption(
        buildChartOption({ ...argsRef.current, dark: isDarkTheme() }),
        { notMerge: true },
      );
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // init 只跑一次；数据更新走下方 merge effect。
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(
      buildChartOption({ points, granularity, baseline, labels, dark: isDarkTheme() }),
      { notMerge: false },
    );
  }, [points, granularity, baseline, labels]);

  return <div className="h-[280px] w-full" data-testid="eval-trend-chart" ref={containerRef} />;
}
