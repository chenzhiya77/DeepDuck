/**
 * 知识图谱可视化的编码纯函数（2026-08-19 spec §5/§6）——独立于 echarts 的
 * 纯数据层，jsdom 可直测，graph-tab / graph-canvas 共用：
 * - nodeSymbolSize：mention_count √开方 → 10–28（抑制长尾）
 * - typeColor / communityColor：FNV-1a 稳定哈希 / 社区 id → 调色板
 * - matchEntityNames：实体搜索模糊匹配
 * - filterNeighborhood：局部图 N 跳 BFS 裁剪
 * - buildGraphSeries / graphTooltipFormatter：echarts option 组装与 tooltip
 */
import type { GraphRetrievalTrace, KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";

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

// ── 缩放分级标签（2026-08-19 标签密集治理）─────────────────────────────────
// 对齐 Neo4j Bloom / Gephi 惯例：缩略态减标签，避免文字铺满画布遮挡节点，
// 同时释放空白像素给 roam 平移手势（事件路由：命中标签=拖节点，命中空白=平移）。

/** 低于此缩放级别全部隐藏标签（缩略导航态；hover emphasis 仍显示单个）。 */
export const LABEL_ZOOM_HIDE_BELOW = 0.6;
/** 达到此缩放级别全部显示标签（配 labelLayout.hideOverlap 防重叠）。 */
export const LABEL_ZOOM_FULL_ABOVE = 0.9;
/** 中档「重要节点」的 mention 阈值：>= 2 才显示标签。 */
export const IMPORTANT_MENTION_MIN = 2;

export type LabelTier = "hidden" | "important" | "full";

/** 缩放级别 → 标签档位。边界归属：0.6 入中档，0.9 入全显档。 */
export function labelTierForZoom(zoom: number): LabelTier {
  if (zoom < LABEL_ZOOM_HIDE_BELOW) return "hidden";
  if (zoom < LABEL_ZOOM_FULL_ABOVE) return "important";
  return "full";
}

/**
 * tier + 节点 → 标签文本（供 echarts label.formatter 调用）。
 *
 * 用 formatter 而非 setOption data 实现分级（2026-08-19 实测踩坑）：series.data
 * 是整体替换语义，部分字段的 data 会清掉原 datum 的 itemStyle/symbolSize →
 * 全图节点回落默认色板蓝色。formatter 只决定文本，不触碰 data。
 * 返回空串 = 不显示该标签（空标签不参与 labelLayout 计算）。
 */
export function labelTextForTier(
  node: KnowledgeGraphNode | undefined,
  tier: LabelTier,
  fallbackName: string,
): string {
  if (tier === "hidden") return "";
  if (tier === "important" && (node?.mention_count ?? 0) < IMPORTANT_MENTION_MIN) return "";
  return fallbackName;
}

// ── P4 检索路径叠加（2026-08-19 spec §7，2026-08-20 发光描边重设计）─────────
// 叠加层是诊断镜头，不破坏底图编码：填充色一律保留（类型/社区语义），层语义由
// 描边 + 发光 + 尺寸承载；非命中节点原样保留（不灰化，空间上下文不丢）；
// 命中路径边（两端均在 trace 并集）荧光金发光。

/** 种子实体描边/发光色（红=路径源头，对齐向量空间命中强调色）。 */
export const GRAPH_SEED_BORDER_COLOR = "#f5222d";
/** 证据实体描边/发光色（荧光金=最终落点；双主题通用，白色发光浅色底不可见故不采用）。 */
export const GRAPH_EVIDENCE_BORDER_COLOR = "#ffd700";
/** 扩展路径 hop 层描边色板：hop-1 橙、hop-2 黄（无发光，视觉权重弱于种子/证据）。 */
export const GRAPH_HOP_BORDER_COLORS: Record<number, string> = { 1: "#fa8c16", 2: "#fadb14" };
/** 种子节点放大倍率（在 mention 基底尺寸上乘算）。 */
export const GRAPH_SEED_SIZE_BOOST = 1.35;
/** 种子/证据描边宽度与发光强度。 */
export const GRAPH_ROLE_BORDER_WIDTH = 3;
export const GRAPH_HOP_BORDER_WIDTH = 2;
export const GRAPH_NODE_GLOW_BLUR = 12;
/** 命中路径边：荧光金 + 发光。 */
export const GRAPH_PATH_COLOR = "#ffd700";
export const GRAPH_PATH_WIDTH = 2;
export const GRAPH_PATH_GLOW_BLUR = 8;

/** series data 里的节点 datum：携带原始 node 供点击钻取回取。 */
export interface GraphDatum {
  name: string;
  symbolSize: number;
  itemStyle: {
    /** 填充恒为自身色（社区/类型）——叠加层绝不覆盖。 */
    color: string;
    /** P4 叠加角色描边（种子红 / 证据金 / hop 橙黄）。 */
    borderColor?: string;
    borderWidth?: number;
    /** 发光（种子/证据；hop 层不发光）。 */
    shadowColor?: string;
    shadowBlur?: number;
  };
  node: KnowledgeGraphNode;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  description: string;
  lineStyle: {
    curveness: number;
    /** P4 命中路径边：荧光金 + 发光。 */
    color?: string;
    width?: number;
    shadowColor?: string;
    shadowBlur?: number;
  };
}

/** trace → 三层查询表（Set/Map O(1) 判定；null overlay → null 短路）。 */
function overlayLookup(overlay: GraphRetrievalTrace | null | undefined) {
  if (!overlay) return null;
  const seeds = new Set(overlay.seed_entities);
  const hops = new Map(overlay.expanded_nodes.map((node) => [node.name, node.hop]));
  const evidence = new Set(overlay.evidence_entities);
  // 路径边判定用并集：种子 ∪ 扩展 ∪ 证据（等价于 graph_search 的 seen 子图）。
  const all = new Set<string>([...seeds, ...hops.keys(), ...evidence]);
  return { seeds, hops, evidence, all };
}

/**
 * 组装 series data。填充一律保留自身色；角色优先级：种子 > 证据 > hop 层
 * （同节点多角色时源头语义最强）。trace 中已不在图里的实体名自然跳过
 * （陈旧 trace 容错）；未命中节点原样返回（不灰化不描边）。
 */
export function buildGraphData(
  nodes: readonly KnowledgeGraphNode[],
  colorBy: GraphColorBy = "community",
  overlay?: GraphRetrievalTrace | null,
): GraphDatum[] {
  const lookup = overlayLookup(overlay);
  return nodes.map((node) => {
    const ownColor = colorBy === "community" ? communityColor(node.community) : typeColor(node.type);
    const baseSize = nodeSymbolSize(node.mention_count);
    const datum: GraphDatum = { name: node.id, symbolSize: baseSize, itemStyle: { color: ownColor }, node };
    if (!lookup) return datum;
    const isSeed = lookup.seeds.has(node.id);
    const isEvidence = lookup.evidence.has(node.id);
    const hop = lookup.hops.get(node.id);
    if (isSeed) {
      datum.symbolSize = Math.round(baseSize * GRAPH_SEED_SIZE_BOOST);
      datum.itemStyle = {
        ...datum.itemStyle,
        borderColor: GRAPH_SEED_BORDER_COLOR,
        borderWidth: GRAPH_ROLE_BORDER_WIDTH,
        shadowColor: GRAPH_SEED_BORDER_COLOR,
        shadowBlur: GRAPH_NODE_GLOW_BLUR,
      };
    } else if (isEvidence) {
      datum.itemStyle = {
        ...datum.itemStyle,
        borderColor: GRAPH_EVIDENCE_BORDER_COLOR,
        borderWidth: GRAPH_ROLE_BORDER_WIDTH,
        shadowColor: GRAPH_EVIDENCE_BORDER_COLOR,
        shadowBlur: GRAPH_NODE_GLOW_BLUR,
      };
    } else if (hop !== undefined) {
      // hop 超出 2（未来更深扩展）按最浅档色板回绕。
      datum.itemStyle = {
        ...datum.itemStyle,
        borderColor: GRAPH_HOP_BORDER_COLORS[hop] ?? GRAPH_HOP_BORDER_COLORS[2]!,
        borderWidth: GRAPH_HOP_BORDER_WIDTH,
      };
    }
    return datum;
  });
}

/**
 * 组装 series links。命中路径边（两端均在 trace 并集——等价于 graph_search
 * 的 seen 关系子图）荧光金发光；其余边原样（不淡化）。
 */
export function buildGraphLinks(edges: readonly KnowledgeGraphEdge[], overlay?: GraphRetrievalTrace | null): GraphLink[] {
  const lookup = overlayLookup(overlay);
  return edges.map((edge) => {
    const onPath = lookup != null && lookup.all.has(edge.source) && lookup.all.has(edge.target);
    return {
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      description: edge.description,
      // 双向/多重关系轻微弯曲防重叠（spec §10：并行边不合并，曲率错开）。
      lineStyle: onPath
        ? {
            curveness: 0.1,
            color: GRAPH_PATH_COLOR,
            width: GRAPH_PATH_WIDTH,
            shadowColor: GRAPH_PATH_COLOR,
            shadowBlur: GRAPH_PATH_GLOW_BLUR,
          }
        : { curveness: 0.1 },
    };
  });
}

export interface GraphSeriesConfig {
  type: "graph";
  layout: "force";
  roam: boolean;
  draggable: boolean;
  /** 缩放上下限：防缩放到失控找不到图（不设限时滚轮可无限缩）。 */
  scaleLimit: { min: number; max: number };
  edgeSymbol: [string, string];
  edgeSymbolSize: [number, number];
  force: {
    repulsion: number;
    edgeLength: [number, number];
    gravity: number;
    layoutAnimation: boolean;
  };
  emphasis: { focus: "adjacency"; label: { show: boolean } };
  label: { show: boolean; position: string; fontSize: number };
  /** echarts 5.1+ 内建防重叠：重叠标签自动隐藏（密集区只留稀疏可读标签）。 */
  labelLayout: { hideOverlap: boolean };
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
  overlay?: GraphRetrievalTrace | null,
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
      emphasis: {
        focus: "adjacency",
        // hidden/important 档系列级 label.show=false 时，hover 单个节点仍要看到
        // 名字（emphasis.label.show 优先级高于 normal，canvas 层合并时保留）。
        label: { show: true },
      },
      label: { show: true, position: "right", fontSize: 11 },
      labelLayout: { hideOverlap: true },
      scaleLimit: { min: 0.3, max: 3 },
      data: buildGraphData(nodes, colorBy, overlay),
      links: buildGraphLinks(edges, overlay),
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
