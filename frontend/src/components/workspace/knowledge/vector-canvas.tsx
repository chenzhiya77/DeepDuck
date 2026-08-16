"use client";

/**
 * echarts 适配层（2026-08-15 spec §8）：jsdom 不可运行，DOM 测试中整体 mock。
 * 经 next/dynamic(ssr:false) 由 vector-tab 懒加载——不进首屏 chunk。
 * 本任务（Task 6）只接 2D scatter；scatter3D + echarts-gl 在 Task 7 接入。
 */
import { ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import type { VectorProjectionPoint } from "@/core/knowledge/types";

import type { VectorSeriesGroup } from "./vector-tab";

echarts.use([ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

/** source_type → 散点形状（双编码：形状分大类，颜色分组）。 */
const SOURCE_SYMBOLS: Record<string, string> = {
  chunk: "circle",
  entity: "triangle",
  wiki: "rect",
  card: "diamond",
};

export interface VectorCanvasProps {
  series: VectorSeriesGroup[];
  dims: 2 | 3;
  onPointClick?: (point: VectorProjectionPoint) => void;
}

interface ScatterDatum {
  value: [number, number];
  point: VectorProjectionPoint;
}

export default function VectorCanvas({ series, dims, onPointClick }: VectorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  // onPointClick 经 ref 穿透，避免回调 identity 变化触发 setOption。
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;
    chart.on("click", (params) => {
      const datum = (params as { data?: ScatterDatum }).data;
      if (datum?.point) {
        clickRef.current?.(datum.point);
      }
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        animation: false,
        textStyle: { fontSize: 11 },
        legend: {
          type: "scroll",
          bottom: 0,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 11 },
        },
        grid: { top: 12, right: 16, bottom: 36, left: 16, containLabel: false },
        xAxis: { type: "value", show: false, scale: true },
        yAxis: { type: "value", show: false, scale: true },
        // 交互三件套之一（spec §8）：滚轮/拖拽缩放；hover tooltip 与点击
        // 详情分别由 tooltip/click 承担。
        dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "inside", yAxisIndex: 0 }],
        tooltip: {
          trigger: "item",
          confine: true,
          formatter: (params) => {
            const datum = (params as { data?: ScatterDatum }).data;
            if (!datum?.point) return "";
            const preview = datum.point.preview;
            const escapedLabel = escapeHtml(datum.point.label);
            return preview ? `${escapedLabel}<br/><span style="opacity:.75">${escapeHtml(preview)}</span>` : escapedLabel;
          },
        },
        series: series.map((group) => ({
          type: "scatter",
          name: group.label,
          symbol: SOURCE_SYMBOLS[group.sourceType] ?? "circle",
          symbolSize: group.sourceType === "chunk" ? 7 : 10,
          itemStyle: { color: group.color, opacity: 0.85 },
          emphasis: { focus: "series", itemStyle: { opacity: 1 } },
          data: group.points.map((point): ScatterDatum => ({ value: [point.x, point.y], point })),
        })),
      },
      { notMerge: true },
    );
  }, [series, dims]);

  return <div className="h-full w-full" data-testid="vector-canvas" ref={containerRef} />;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
