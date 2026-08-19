"use client";

/**
 * 知识图谱画布（2026-08-19 spec §5 P2）：echarts `graph` 系列力导向渲染
 * 实体/关系。文件分两层：
 * - 纯函数（jsdom 可测）：nodeSymbolSize / fnv1aHash / typeColor /
 *   buildGraphSeries / graphTooltipFormatter；
 * - 组件（浏览器专属）：echarts 按需注册 + init/setOption/resize/click。
 *
 * 视觉编码（与向量空间同套设计语言）：
 * - 节点大小 = mention_count √开方映射 10–28（抑制长尾）；
 * - 节点颜色 = 实体 type 的 FNV-1a 稳定哈希 → 调色板取模（同 type 恒同色）；
 * - 边 = 灰细线 + 末端箭头（有向）；hover 节点时一跳邻居保持、其余淡化
 *   （echarts graph 内置 emphasis.focus="adjacency"）。
 */
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";

import { buildTooltipHtml } from "./vector-canvas";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

// ── 纯函数层（jsdom 可测）────────────────────────────────────────────────

/**
 * 节点着色色板（Material Design 400 级，与向量空间 SOURCE_COLORS 同色系）。
 * type 与社区（P3 切换）共用一组——取模映射，数量任意。
 */
export const COMMUNITY_PALETTE: readonly string[] = [
  "#42a5f5", // blue 400
  "#66bb6a", // green 400
  "#ffa726", // orange 400
  "#ab47bc", // purple 400
  "#26c6da", // cyan 400
  "#ec407a", // pink 400
  "#9ccc65", // light green 400
  "#ff7043", // deep orange 400
  "#7e57c2", // deep purple 400
  "#8d6e63", // brown 400
];

/** FNV-1a 32 位哈希：短字符串稳定着色的经典选择（同 key 跨渲染恒同值）。 */
export function fnv1aHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619 的 32 位溢出等价（Math.imul 保低位）。
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 实体 type → 色板稳定取色。空 type 也走哈希（落固定桶），不特殊置灰。 */
export function typeColor(type: string): string {
  return COMMUNITY_PALETTE[fnv1aHash(type) % COMMUNITY_PALETTE.length]!;
}

/** 节点尺寸：√count 映射 10–28——mention 长尾被开方压平，巨头不霸屏。 */
export function nodeSymbolSize(mentionCount: number): number {
  if (mentionCount <= 0) return 10;
  return Math.min(28, 10 + 6 * Math.sqrt(mentionCount));
}

/** series data 里的节点 datum：携带原始 node 供点击钻取回取。 */
interface GraphDatum {
  name: string;
  symbolSize: number;
  itemStyle: { color: string };
  node: KnowledgeGraphNode;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  description: string;
  lineStyle: { curveness: number };
}

export interface GraphSeriesConfig {
  type: "graph";
  layout: "force";
  roam: boolean;
  draggable: boolean;
  edgeSymbol: [string, string];
  edgeSymbolSize: [number, number];
  force: {
    repulsion: number;
    edgeLength: [number, number];
    gravity: number;
    layoutAnimation: boolean;
  };
  emphasis: { focus: "adjacency" };
  label: { show: boolean; position: string; fontSize: number };
  data: GraphDatum[];
  links: GraphLink[];
}

/**
 * 组装 graph 系列（P2 默认按 type 着色；P3 着色切换在 Task 4 加参数）。
 * force 参数为 100~500 节点档调参钉死值：repulsion 120 + edgeLength 40–120
 * 让社区自然成簇，gravity 0.1 防图甩出视口。
 */
export function buildGraphSeries(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
): [GraphSeriesConfig] {
  return [
    {
      type: "graph",
      layout: "force",
      roam: true,
      draggable: true,
      edgeSymbol: ["none", "arrow"],
      edgeSymbolSize: [0, 6],
      force: {
        repulsion: 120,
        edgeLength: [40, 120],
        gravity: 0.1,
        layoutAnimation: true,
      },
      emphasis: { focus: "adjacency" },
      label: { show: true, position: "right", fontSize: 11 },
      data: nodes.map((node) => ({
        name: node.id,
        symbolSize: nodeSymbolSize(node.mention_count),
        itemStyle: { color: typeColor(node.type) },
        node,
      })),
      links: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        description: edge.description,
        // 双向/多重关系轻微弯曲防重叠（spec §10：并行边不合并，曲率错开）。
        lineStyle: { curveness: 0.1 },
      })),
    },
  ];
}

interface TooltipParams {
  dataType: "node" | "edge";
  data: Record<string, unknown>;
}

/** tooltip formatter：节点 = 实体名 + 描述截断；边 = s → t 关系 + 描述。 */
export function graphTooltipFormatter(params: TooltipParams): string {
  if (params.dataType === "edge") {
    const data = params.data as { source: string; target: string; relation: string; description?: string };
    // buildTooltipHtml 内部跳过空 preview——空串直传即可。
    return buildTooltipHtml(`${data.source} → ${data.target} · ${data.relation}`, data.description);
  }
  const data = params.data as { name: string; node?: KnowledgeGraphNode };
  return buildTooltipHtml(data.name, data.node?.description);
}

// ── 组件层（浏览器专属）──────────────────────────────────────────────────

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
  /** 点击节点 → 实体钻取（抽屉由 graph-tab 渲染）。 */
  onNodeClick: (node: KnowledgeGraphNode) => void;
}

export default function GraphCanvas({ nodes, edges, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // onNodeClick 穿透 ref：数据刷新重建 option 时不需要重绑事件。
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  // 初始化一次：主题感知的静态配置（tooltip 外观/边色/标签色）也在这里，
  // 主题切换不重建（下一 tick 的 setOption 不覆盖这些字段，可接受——
  // 对齐 vector-canvas 的主题处理力度）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;

    chart.on("click", (params) => {
      const p = params as { dataType?: string; data?: unknown };
      if (p.dataType !== "node") return;
      const node = (p.data as GraphDatum | undefined)?.node;
      if (node) onNodeClickRef.current(node);
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
    const [series] = buildGraphSeries(nodes, edges);
    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: (params: unknown) => graphTooltipFormatter(params as TooltipParams),
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
  }, [nodes, edges]);

  return <div ref={containerRef} className="h-full w-full" data-testid="graph-canvas" />;
}
