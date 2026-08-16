"use client";

/**
 * echarts 适配层（2026-08-15 spec §8）：jsdom 不可运行，DOM 测试中整体 mock。
 * 经 next/dynamic(ssr:false) 由 vector-tab 懒加载——不进首屏 chunk。
 * Task 6 接 2D scatter；Task 7 接 scatter3D（echarts-gl）。
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
import { Scatter3DChart } from "echarts-gl/charts";
import { Grid3DComponent } from "echarts-gl/components";
import { useEffect, useRef } from "react";

import type { VectorProjectionPoint } from "@/core/knowledge/types";

import type { VectorSeriesGroup } from "./vector-tab";

echarts.use([
  ScatterChart,
  Scatter3DChart,
  GridComponent,
  Grid3DComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

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
  value: [number, number] | [number, number, number];
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
    const common = {
      animation: false,
      textStyle: { fontSize: 11 },
      legend: {
        type: "scroll" as const,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
      },
      tooltip: {
        trigger: "item" as const,
        confine: true,
        formatter: (params: unknown) => {
          const datum = (params as { data?: ScatterDatum }).data;
          if (!datum?.point) return "";
          const preview = datum.point.preview;
          const escapedLabel = escapeHtml(datum.point.label);
          return preview
            ? `${escapedLabel}<br/><span style="opacity:.75">${escapeHtml(preview)}</span>`
            : escapedLabel;
        },
      },
      series: series.map((group) => ({
        type: dims === 3 ? "scatter3D" : "scatter",
        name: group.label,
        symbol: SOURCE_SYMBOLS[group.sourceType] ?? "circle",
        symbolSize: group.sourceType === "chunk" ? 7 : 10,
        itemStyle: { color: group.color, opacity: 0.85 },
        emphasis: { focus: "series", itemStyle: { opacity: 1 } },
        data: group.points.map((point): ScatterDatum => ({
          value: dims === 3 ? [point.x, point.y, point.z ?? 0] : [point.x, point.y],
          point,
        })),
      })),
    };
    // 3D 分支：grid3D + 三轴（viewControl 内置拖拽旋转/滚轮缩放）；
    // 2D 分支：grid + 双轴 + inside dataZoom。
    const option =
      dims === 3
        ? {
            ...common,
            xAxis3D: { type: "value", show: false, scale: true },
            yAxis3D: { type: "value", show: false, scale: true },
            zAxis3D: { type: "value", show: false, scale: true },
            grid3D: { top: "8%", bottom: "12%", viewControl: { distance: 220 } },
          }
        : {
            ...common,
            grid: { top: 12, right: 16, bottom: 36, left: 16, containLabel: false },
            xAxis: { type: "value", show: false, scale: true },
            yAxis: { type: "value", show: false, scale: true },
            dataZoom: [
              { type: "inside", xAxisIndex: 0 },
              { type: "inside", yAxisIndex: 0 },
            ],
          };
    chart.setOption(option, { notMerge: true });
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
