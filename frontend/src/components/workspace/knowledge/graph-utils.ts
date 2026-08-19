/**
 * 知识图谱可视化的编码纯函数（2026-08-19 spec §5/§6）——独立于 echarts 的
 * 纯数据层，jsdom 可直测，graph-tab / graph-canvas 共用：
 * - nodeSymbolSize：mention_count √开方 → 10–28（抑制长尾）
 * - typeColor / communityColor：FNV-1a 稳定哈希 / 社区 id → 调色板
 * - matchEntityNames：实体搜索模糊匹配
 * - filterNeighborhood：局部图 N 跳 BFS 裁剪
 * - buildGraphSeries / graphTooltipFormatter：echarts option 组装与 tooltip
 */
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";

import { buildTooltipHtml } from "./vector-canvas";

/**
 * 节点着色色板（Material Design 400 级，与向量空间 SOURCE_COLORS 同色系）。
 * type 与社区共用一组——取模映射，数量任意。
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

/** 社区 id → 色板取色（社区按规模降序，主色恒给最大社区；越界取模回绕）。 */
export function communityColor(community: number): string {
  return COMMUNITY_PALETTE[community % COMMUNITY_PALETTE.length]!;
}

/** 着色模式（spec §6）：默认按社区（结构洞察优先），可切按类型。 */
export type GraphColorBy = "type" | "community";

/** 实体搜索：实体名大小写不敏感子串匹配，返回命中节点 id（保持数据序）。 */
export function matchEntityNames(nodes: readonly KnowledgeGraphNode[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes.filter((node) => node.id.toLowerCase().includes(needle)).map((node) => node.id);
}

/**
 * 局部图裁剪（spec §6）：焦点节点 + N 跳邻居（BFS，有向边按无向扩展——对齐
 * graph_search 的邻域语义）。返回裁剪后的节点/边（引用原对象，不复制）。
 */
export function filterNeighborhood(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  focusId: string,
  hops: number,
): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(focusId)) return { nodes: [], edges: [] };
  const kept = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const edge of edges) {
      for (const endpoint of [edge.source, edge.target] as const) {
        const other = endpoint === edge.source ? edge.target : edge.source;
        if (frontier.includes(endpoint) && !kept.has(other)) {
          kept.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: nodes.filter((node) => kept.has(node.id)),
    edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  };
}

/** 节点尺寸：√count 映射 10–28——mention 长尾被开方压平，巨头不霸屏。 */
export function nodeSymbolSize(mentionCount: number): number {
  if (mentionCount <= 0) return 10;
  return Math.min(28, 10 + 6 * Math.sqrt(mentionCount));
}

/** series data 里的节点 datum：携带原始 node 供点击钻取回取。 */
export interface GraphDatum {
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
 * 组装 graph 系列（spec §6：默认按社区着色）。force 参数为 100~500 节点档
 * 调参钉死值：repulsion 120 + edgeLength 40–120 让社区自然成簇，
 * gravity 0.1 防图甩出视口。
 */
export function buildGraphSeries(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  colorBy: GraphColorBy = "community",
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
        itemStyle: { color: colorBy === "community" ? communityColor(node.community) : typeColor(node.type) },
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

export interface GraphTooltipParams {
  dataType: "node" | "edge";
  data: Record<string, unknown>;
}

/** tooltip formatter：节点 = 实体名 + 描述截断；边 = s → t 关系 + 描述。 */
export function graphTooltipFormatter(params: GraphTooltipParams): string {
  if (params.dataType === "edge") {
    const data = params.data as { source: string; target: string; relation: string; description?: string };
    // buildTooltipHtml 内部跳过空 preview——空串直传即可。
    return buildTooltipHtml(`${data.source} → ${data.target} · ${data.relation}`, data.description);
  }
  const data = params.data as { name: string; node?: KnowledgeGraphNode };
  return buildTooltipHtml(data.name, data.node?.description);
}
