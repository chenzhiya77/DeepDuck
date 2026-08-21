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

import type { GraphRetrievalTrace, KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";

import {
  buildAdjacencyMap,
  buildCommunityColorMap,
  buildGraphData,
  buildGraphLinks,
  buildGraphSeries,
  type GraphColorBy,
  type GraphDatum,
  type GraphTooltipParams,
  graphTooltipFormatter,
  type LabelTier,
  labelTextForTier,
  labelTierForZoom,
} from "./graph-utils";

// 纯函数与类型的单测入口对齐 vector-canvas 先例——从 canvas 模块 re-export，
// 测试 import 路径保持 "@/components/workspace/knowledge/graph-canvas"。
export {
  buildAdjacencyMap,
  buildCommunityColorMap,
  buildGraphData,
  buildGraphLinks,
  buildGraphSeries,
  COMMUNITY_PALETTE,
  filterNeighborhood,
  fnv1aHash,
  GRAPH_EXPANSION_BORDER_COLOR,
  GRAPH_HIT_BORDER_COLOR,
  GRAPH_HOVER_BORDER_COLOR,
  GRAPH_PATH_COLOR,
  type GraphColorBy,
  graphTooltipFormatter,
  IMPORTANT_MENTION_MIN,
  LABEL_ZOOM_FULL_ABOVE,
  LABEL_ZOOM_HIDE_BELOW,
  type LabelTier,
  labelTextForTier,
  labelTierForZoom,
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
  /** P4 检索路径叠加（spec §7）：种子/扩展/证据三层染色；null = 无叠加。 */
  overlay?: GraphRetrievalTrace | null;
  /** 单击节点 → 实体钻取（抽屉由 graph-tab 渲染）。 */
  onNodeClick: (node: KnowledgeGraphNode) => void;
  /** 双击节点 → 进入局部图模式（spec §6，对齐 Obsidian）。 */
  onNodeDblClick: (node: KnowledgeGraphNode) => void;
}

/**
 * 放宽 graph roam 的手势范围到全画布（2026-08-20 圈外拖拽修复）。
 *
 * 根因：echarts GraphView._updateController 把 RoamController.pointerChecker 限定为
 * 「图内容包围盒内」，空白区域（节点团外）不触发平移/缩放。但节点拖拽已被独立保护
 * ——_mousedownHandler 会先检查 e.target 是否 draggable（是则提前返回），所以强制
 * checker 恒 true 只会让空白区域可平移，不会破坏节点拖拽。
 *
 * 注意：echarts 每次 render 会重设 checker，必须在 chart.on('rendered') 里重新覆盖。
 */
export function widenRoamPointerChecker(chart: unknown): void {
  if (!chart || typeof chart !== "object") return;
  const internals = chart as {
    _chartsViews?: Array<{
      _controller?: { setPointerChecker(checker: () => boolean): void };
    }>;
  };
  if (!internals._chartsViews?.length) return;
  for (const view of internals._chartsViews) {
    view?._controller?.setPointerChecker(() => true);
  }
}

export default function GraphCanvas({ nodes, edges, colorBy, focusNode, overlay, onNodeClick, onNodeDblClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // 回调穿透 ref：数据刷新重建 option 时不需要重绑事件。
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeDblClickRef = useRef(onNodeDblClick);
  onNodeDblClickRef.current = onNodeDblClick;
  // 标签档位去重：graphRoam 在平移时也会触发（zoom 不变 → tier 不变 → 短路）。
  const labelTierRef = useRef<LabelTier>("full");
  // overlay 穿透 ref：全量重建 effect 读取最新叠加但不以其为依赖（叠加单变更
  // 走下方 merge 更新，不重跑力导向布局——对齐向量空间「叠加系列槽位」教训）。
  const overlayRef = useRef(overlay ?? null);
  overlayRef.current = overlay ?? null;
  // 最近一次全量重建的输入指纹（引用对比）：overlay-only 变更才可走 merge 更新。
  const lastFullRebuildRef = useRef<{
    nodes: readonly KnowledgeGraphNode[];
    edges: readonly KnowledgeGraphEdge[];
    colorBy: GraphColorBy;
  } | null>(null);
  const appliedOverlayRef = useRef<GraphRetrievalTrace | null>(null);
  // hover 邻域提亮的邻接表：effect A 数据重建时刷新，事件 handler 经 ref 读最新值。
  const adjacencyRef = useRef<Map<string, string[]>>(new Map());

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

    // hover 邻域提亮（2026-08-20 加法高亮）：echarts focus:adjacency 只保证邻居
    // 「不被压暗」而非主动高亮（states.js：只有当前 hover 元素进 emphasis）——
    // 邻居提亮必须手动 dispatch highlight，让「当前节点+1 跳邻居」同走蓝描边。
    // 系列不配 focus/blur，其他元素全程 normal：纯加法，零闪烁。
    const dispatchNeighborhood = (params: unknown, action: "highlight" | "downplay") => {
      const p = params as { dataType?: string; name?: unknown };
      if (p.dataType !== "node" || typeof p.name !== "string") return;
      const names = [p.name, ...(adjacencyRef.current.get(p.name) ?? [])];
      chart.dispatchAction({ type: action, seriesIndex: 0, name: names });
    };
    chart.on("mouseover", (params) => dispatchNeighborhood(params, "highlight"));
    chart.on("mouseout", (params) => dispatchNeighborhood(params, "downplay"));
    // 鼠标直接甩出画布时兜底：downplay 无参=清除全部高亮（防滞留）。
    chart.on("globalout", () => {
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
    });

    // 缩放分级标签（2026-08-19 标签密集治理）：zoom 跨档时才 setOption。
    // chart.on 注册的监听挂在实例上，setOption（含 notMerge）不会清除——
    // 只需初始化时绑一次。zoom 从 option 读（roam 平移也触发本事件，事件参数
    // 不可靠，以 option 中的当前 zoom 为准）。
    // 分级用 label.formatter 实现——绝不能 setOption 部分字段的 series.data
    // （整体替换语义会丢 itemStyle/symbolSize，全图节点回落默认色板蓝色）。
    chart.on("graphRoam", () => {
      const seriesOptions = chart.getOption().series as Array<{ zoom?: number }> | undefined;
      const zoom = typeof seriesOptions?.[0]?.zoom === "number" ? seriesOptions[0].zoom : 1;
      const tier = labelTierForZoom(zoom);
      if (tier === labelTierRef.current) return;
      labelTierRef.current = tier;
      chart.setOption({
        series: [
          {
            label: {
              show: true,
              formatter: (params: { data?: unknown }) => {
                const data = params.data as GraphDatum | undefined;
                return labelTextForTier(data?.node, tier, data?.name ?? "");
              },
            },
          },
        ],
      });
    });

    const observer = new ResizeObserver(() => {
      chart.resize();
      // resize 触发渲染 → 重设 checker，补覆盖。
      widenRoamPointerChecker(chart);
    });
    observer.observe(container);

    // echarts 每次 render 会重设 checker 为包围盒模式——必须在 rendered 后重新覆盖，
    // 否则 resize/setOption 后圈外手势又静默失效。
    chart.on("rendered", () => {
      widenRoamPointerChecker(chart);
    });

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 数据 → option。nodes/edges 来自 React Query（引用稳定），变化即整体重建
  // 布局（force 图节点集合变化后位置本就应重排，notMerge 语义对齐）。
  // 当前叠加经 overlayRef 参与重建——数据变了，叠加染色必须随新数据一起落地。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dark = isDarkTheme();
    const activeOverlay = overlayRef.current;
    // hover 邻域提亮的邻接表随数据重建刷新（mouseover handler 经 ref 读最新值）。
    adjacencyRef.current = buildAdjacencyMap(edges);
    const [series] = buildGraphSeries(nodes, edges, colorBy, activeOverlay);
    // 数据重建后标签档位回到 full（notMerge 清掉了 roam 期间的档位覆盖），
    // 同步重置 ref——否则下次 roam 到同一档会因去重短路而丢失标签状态。
    labelTierRef.current = "full";
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
            // opacity 必须显式钉死为 1：echarts graph 默认 lineStyle.opacity 0.5，
            // 若继承它，blur.lineStyle.opacity=1（零淡化意图）反而把 hover 时的
            // 非邻接边从 0.5 提亮到 1——「全局边高亮」事故根因（2026-08-20 排查）。
            lineStyle: { color: ink(0.35, dark), width: 1, opacity: 1 },
            label: { ...series.label, color: ink(0.75, dark) },
          },
        ],
      },
      { notMerge: true },
    );
    // notMerge 重建会重设 checker——立即覆盖（rendered 事件兜底之外的防御）。
    widenRoamPointerChecker(chart);
    lastFullRebuildRef.current = { nodes, edges, colorBy };
    appliedOverlayRef.current = activeOverlay;
  }, [nodes, edges, colorBy]);

  // P4 叠加单变更（spec §7）：只替换 series 的 data/links（merge 模式），
  // 保留力导向布局位置与视口——全量重建会让节点重新模拟、用户视角丢失。
  // data/links 都是整体替换语义（完整 datum 携带 itemStyle/symbolSize，
  // 不会重蹈 Task 4 部分字段丢失的坑）。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const last = lastFullRebuildRef.current;
    // nodes/edges 引用恒非空——last 缺失（未全量重建过）时 ?. 求值为 undefined ≠ nodes，恒走 return。
    if (last?.nodes !== nodes || last.edges !== edges || last.colorBy !== colorBy) {
      return; // 数据未就绪或刚变更——等全量重建 effect 处理（它经 overlayRef 读最新值）。
    }
    const next = overlay ?? null;
    if (appliedOverlayRef.current === next) return;
    appliedOverlayRef.current = next;
    // 与全量重建一致的 Welsh-Powell 色号分配（相邻社区异色；type 模式不需要）。
    const colorMap = colorBy === "community" ? buildCommunityColorMap(nodes, edges) : undefined;
    chart.setOption({ series: [{ data: buildGraphData(nodes, colorBy, next, colorMap), links: buildGraphLinks(edges, next) }] });
  }, [overlay, nodes, edges, colorBy]);

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
