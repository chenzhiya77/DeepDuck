"use client";

/**
 * 知识图谱画布（2026-08-19 spec §5/§6）：echarts `graph` 系列力导向渲染
 * 实体/关系。纯编码函数在 ./graph-utils（jsdom 可直测）；本文件只做
 * echarts 适配：init / setOption / resize / click·dblclick 事件 / 搜索居中。
 */
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";

import {
  buildGraphSeries,
  type GraphColorBy,
  type GraphDatum,
  type GraphTooltipParams,
  graphTooltipFormatter,
} from "./graph-utils";

// 纯函数与类型的单测入口对齐 vector-canvas 先例——从 canvas 模块 re-export，
// 测试 import 路径保持 "@/components/workspace/knowledge/graph-canvas"。
export {
  buildGraphSeries,
  COMMUNITY_PALETTE,
  filterNeighborhood,
  fnv1aHash,
  type GraphColorBy,
  graphTooltipFormatter,
  matchEntityNames,
  nodeSymbolSize,
  typeColor,
} from "./graph-utils";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

/** 当前是否暗色主题（next-themes 在 <html> 上挂 .dark class）。 */
function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** 墨色：浅色主题用深灰，暗色主题翻成亮灰（边/标签等装饰元素）。 */
function ink(alpha: number, dark: boolean): string {
  return dark ? `rgba(235,238,245,${alpha})` : `rgba(60,60,60,${alpha})`;
}

export interface GraphCanvasProps {
  nodes: readonly KnowledgeGraphNode[];
  edges: readonly KnowledgeGraphEdge[];
  /** 着色模式（spec §6）：默认按社区，可切按类型。 */
  colorBy: GraphColorBy;
  /** 搜索定位：命中的节点 id（居中 + 高亮）；null = 无定位请求。 */
  focusNode: string | null;
  /** 单击节点 → 实体钻取（抽屉由 graph-tab 渲染）。 */
  onNodeClick: (node: KnowledgeGraphNode) => void;
  /** 双击节点 → 进入局部图模式（spec §6，对齐 Obsidian）。 */
  onNodeDblClick: (node: KnowledgeGraphNode) => void;
}

export default function GraphCanvas({ nodes, edges, colorBy, focusNode, onNodeClick, onNodeDblClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // 回调穿透 ref：数据刷新重建 option 时不需要重绑事件。
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeDblClickRef = useRef(onNodeDblClick);
  onNodeDblClickRef.current = onNodeDblClick;

  // 初始化一次：事件绑定与尺寸观察。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;

    const nodeOf = (params: unknown): KnowledgeGraphNode | null => {
      const p = params as { dataType?: string; data?: unknown };
      if (p.dataType !== "node") return null;
      return (p.data as GraphDatum | undefined)?.node ?? null;
    };
    chart.on("click", (params) => {
      const node = nodeOf(params);
      if (node) onNodeClickRef.current(node);
    });
    chart.on("dblclick", (params) => {
      const node = nodeOf(params);
      if (node) onNodeDblClickRef.current(node);
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 数据 → option。nodes/edges 来自 React Query（引用稳定），变化即整体重建
  // 布局（force 图节点集合变化后位置本就应重排，notMerge 语义对齐）。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dark = isDarkTheme();
    const [series] = buildGraphSeries(nodes, edges, colorBy);
    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: (params: unknown) => graphTooltipFormatter(params as GraphTooltipParams),
          backgroundColor: dark ? "rgba(30,32,36,0.92)" : "rgba(255,255,255,0.92)",
          borderWidth: 0,
          textStyle: { color: ink(0.85, dark), fontSize: 12 },
          extraCssText: "backdrop-filter: blur(6px); border-radius: 6px; padding: 6px 10px;",
        },
        series: [
          {
            ...series,
            lineStyle: { color: ink(0.35, dark), width: 1 },
            label: { ...series.label, color: ink(0.75, dark) },
            emphasis: {
              ...series.emphasis,
              lineStyle: { width: 2.5 },
              label: { fontWeight: "bold" },
            },
          },
        ],
      },
      { notMerge: true },
    );
  }, [nodes, edges, colorBy]);

  // 搜索定位（spec §6 P3）：命中节点 → 视图中心平移到该节点 + 高亮。
  // center 语义 = roam 视图中心对应的 layout 坐标（echarts graph 原生支持）；
  // 节点 layout 坐标从 series data 的 getItemLayout 读取（force 布局完成后有值）。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusNode) return;
    const timer = window.setTimeout(() => {
      // 力导向布局动画进行中坐标仍会变——等一个短暂稳定窗再居中（启动动画期
      // 的居中会被后续模拟推开，实测 500ms 后布局已足够稳定）。
      // getModel 是 echarts 内部 API（类型标私有但运行时可用）——读节点 layout
      // 坐标没有公开替代（convertToPixel 不支持 graph 系列的 roam 坐标系）。
      const internals = chart as unknown as {
        getModel(): {
          getSeriesByIndex(i: number): { getData(): { getItemLayout(i: number): [number, number] | undefined } } | undefined;
        };
      };
      const data = internals.getModel().getSeriesByIndex(0)?.getData();
      const index = nodes.findIndex((node) => node.id === focusNode);
      if (!data || index < 0) return;
      const layout = data.getItemLayout(index);
      if (!layout) return;
      chart.setOption({ series: [{ center: [layout[0], layout[1]], zoom: 1.6 }] });
      chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: index });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
    };
  }, [focusNode, nodes]);

  return <div ref={containerRef} className="h-full w-full" data-testid="graph-canvas" />;
}
