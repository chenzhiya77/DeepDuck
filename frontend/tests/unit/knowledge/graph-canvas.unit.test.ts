/**
 * graph-canvas 编码纯函数测试（2026-08-19 spec §5 P2）：
 * - mention_count √开方 → symbolSize 10–28（抑制长尾）
 * - 实体 type FNV-1a 稳定哈希着色（同 type 恒同色，跨渲染稳定）
 * - 边有向箭头配置
 * - tooltip 复用 buildTooltipHtml（label/preview 各 20 字）
 * echarts 画布本体在 jsdom 不可运行，dom 测试整体 mock 后断言 props。
 */
import { describe, expect, it } from "@rstest/core";

import {
  buildAdjacencyMap,
  buildGraphSeries,
  COMMUNITY_PALETTE,
  filterNeighborhood,
  fnv1aHash,
  GRAPH_EXPANSION_BORDER_COLOR,
  GRAPH_HIT_BORDER_COLOR,
  GRAPH_HOVER_BORDER_COLOR,
  GRAPH_PATH_COLOR,
  graphTooltipFormatter,
  IMPORTANT_MENTION_MIN,
  LABEL_ZOOM_FULL_ABOVE,
  LABEL_ZOOM_HIDE_BELOW,
  labelTextForTier,
  labelTierForZoom,
  matchEntityNames,
  nodeSymbolSize,
  typeColor,
  widenRoamPointerChecker,
} from "@/components/workspace/knowledge/graph-canvas";
import type { GraphRetrievalTrace, KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";


function node(id: string, extra: Partial<KnowledgeGraphNode> = {}): KnowledgeGraphNode {
  return {
    id,
    type: "概念",
    description: `${id} 的描述`,
    mention_count: 1,
    community: 0,
    source_chunk_ids: ["d#0000"],
    ...extra,
  };
}

const NODES: KnowledgeGraphNode[] = [
  node("JVM", { type: "组件", mention_count: 9, community: 0, source_chunk_ids: ["d#0000", "d#0001"] }),
  node("堆内存", { community: 0 }),
  node("字节码", { community: 0 }),
  node("孤立概念", { community: 1, source_chunk_ids: ["d#0002"] }),
];

const EDGES: KnowledgeGraphEdge[] = [
  { source: "JVM", target: "堆内存", relation: "包含", description: "" },
  { source: "JVM", target: "字节码", relation: "解释", description: "把字节码翻译为机器码" },
];

describe("nodeSymbolSize（√count → 10–28）", () => {
  it("maps mention counts onto the 10–28 band by square root", () => {
    expect(nodeSymbolSize(1)).toBe(16); // 10 + 6*√1
    expect(nodeSymbolSize(4)).toBe(22); // 10 + 6*√4
    expect(nodeSymbolSize(9)).toBe(28); // 触顶
  });

  it("clamps both tails (0/负数 → 10；长尾大号 → 28 封顶)", () => {
    expect(nodeSymbolSize(0)).toBe(10);
    expect(nodeSymbolSize(-3)).toBe(10);
    expect(nodeSymbolSize(100)).toBe(28);
  });
});

describe("typeColor（FNV-1a 稳定哈希着色）", () => {
  it("is deterministic for the same type across calls", () => {
    expect(typeColor("概念")).toBe(typeColor("概念"));
    expect(typeColor("组件")).toBe(typeColor("组件"));
  });

  it("picks from the shared community palette", () => {
    expect(COMMUNITY_PALETTE).toContain(typeColor("概念"));
    expect(COMMUNITY_PALETTE).toContain(typeColor("组件"));
  });

  it("falls back to a stable bucket for empty type", () => {
    expect(COMMUNITY_PALETTE).toContain(typeColor(""));
    expect(typeColor("")).toBe(typeColor(""));
  });

  it("fnv1aHash is a stable 32-bit unsigned integer", () => {
    const h = fnv1aHash("概念");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(fnv1aHash("概念")).toBe(h);
    expect(fnv1aHash("组件")).not.toBe(h);
  });
});

describe("buildGraphSeries（force 布局配置）", () => {
  it("emits a single force-directed graph series with roam/draggable", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    expect(series.type).toBe("graph");
    expect(series.layout).toBe("force");
    expect(series.roam).toBe(true);
    expect(series.draggable).toBe(true);
    expect(series.force?.layoutAnimation).toBe(true);
    expect(series.force?.repulsion).toBeGreaterThan(0);
    expect(series.force?.gravity).toBeGreaterThan(0);
  });

  it("encodes node size by √mention_count and color by type（显式 colorBy=type）", () => {
    const [series] = buildGraphSeries(NODES, EDGES, "type");
    const data = series.data as Array<{ name: string; symbolSize: number; itemStyle: { color: string } }>;
    expect(data).toHaveLength(4);
    const jvm = data.find((d) => d.name === "JVM")!;
    const heap = data.find((d) => d.name === "堆内存")!;
    expect(jvm.symbolSize).toBe(28); // mention 9 → 触顶
    expect(heap.symbolSize).toBe(16); // mention 1
    expect(jvm.itemStyle.color).toBe(typeColor("组件"));
    expect(heap.itemStyle.color).toBe(typeColor("概念"));
  });

  it("keeps the raw node payload on each datum for click drill-down", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    const jvm = (series.data as Array<{ name: string; node: KnowledgeGraphNode }>).find((d) => d.name === "JVM")!;
    expect(jvm.node.source_chunk_ids).toEqual(["d#0000", "d#0001"]);
  });

  it("emits directed edges with an end arrow and relation label payload", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    const links = series.links as Array<{
      source: string;
      target: string;
      relation: string;
      lineStyle?: { curveness?: number };
    }>;
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ source: "JVM", target: "堆内存", relation: "包含" });
    // 有向箭头：末端 arrow（echarts graph 边级 symbol 配置）。
    expect(series.edgeSymbol).toEqual(["none", "arrow"]);
    expect((series.edgeSymbolSize as number[])[1]).toBeGreaterThan(0);
  });

  it("exposes only self-emphasis styles——邻域提亮由 canvas 手动 dispatch（加法高亮）", () => {
    // 2026-08-20 排查实证（echarts states.js/GraphView.js）：focus:adjacency 下
    // 只有当前 hover 元素进 emphasis，邻接集合的作用仅是「不被 blur」——原版
    // 「邻居高亮」其实是其他节点被压暗的减法错觉，压暗即闪烁根因。
    // 加法高亮：系列不配 focus/blur（其他元素全程 normal 零变化），canvas 层
    // mouseover 时对「当前节点+1 跳邻居」dispatchAction highlight 同走蓝描边。
    const [series] = buildGraphSeries(NODES, EDGES);
    expect(series.emphasis.focus).toBeUndefined(); // 无 focus → 无 blur 分类
    expect(series.emphasis.scale).toBe(false); // 关掉 echarts 默认 hover 放大
    expect(series.stateAnimation).toBe(false); // 即时切换，无渐变残留
    expect(GRAPH_HOVER_BORDER_COLOR).toBe("#1677ff"); // 交互蓝，与命中红/路径金区分
    expect(series.emphasis.itemStyle).toEqual({
      borderColor: GRAPH_HOVER_BORDER_COLOR,
      borderWidth: 3,
      shadowColor: GRAPH_HOVER_BORDER_COLOR,
      shadowBlur: 8, // 轻发光（弱于命中的 12，层级区分）
    });
    expect(series.emphasis.label).toBeUndefined(); // 名字由 tooltip 承载，避免 hideOverlap 重算闪现
    expect(series.emphasis.lineStyle).toBeUndefined(); // 边不做任何变化
  });
});

describe("buildAdjacencyMap（hover 邻域提亮的邻接表）", () => {
  it("builds an undirected adjacency map（有向边按无向邻接，对齐邻域语义）", () => {
    const map = buildAdjacencyMap(EDGES);
    expect(map.get("JVM")).toEqual(["堆内存", "字节码"]); // 两条出边
    expect(map.get("堆内存")).toEqual(["JVM"]); // 入边回指
    expect(map.get("字节码")).toEqual(["JVM"]);
    expect(map.has("孤立概念")).toBe(false); // 无边的节点不产条目
  });

  it("returns an empty map for empty edges", () => {
    expect(buildAdjacencyMap([]).size).toBe(0);
  });
});

describe("graphTooltipFormatter", () => {
  it("renders node tooltip as name + truncated description (buildTooltipHtml 复用)", () => {
    const html = graphTooltipFormatter({
      dataType: "node",
      data: { name: "JVM", node: node("JVM", { description: "Java 虚拟机，负责执行字节码，管理内存与线程" }) },
    });
    expect(html).toContain("JVM");
    expect(html).toContain("Java 虚拟机");
    expect(html.length).toBeLessThan(200); // 截断生效
  });

  it("renders edge tooltip as source → target + relation", () => {
    const html = graphTooltipFormatter({
      dataType: "edge",
      data: { source: "JVM", target: "字节码", relation: "解释", description: "把字节码翻译为机器码" },
    });
    expect(html).toContain("JVM");
    expect(html).toContain("字节码");
    expect(html).toContain("解释");
  });
});

// ── Task 4（P3）：着色切换 / 搜索匹配 / 局部图裁剪 ─────────────────────────

describe("buildGraphSeries colorBy（着色切换）", () => {
  it("colors by community when colorBy=community（社区 id → 色板）", () => {
    const [series] = buildGraphSeries(NODES, EDGES, "community");
    const data = series.data as Array<{ name: string; itemStyle: { color: string } }>;
    const byName = new Map(data.map((d) => [d.name, d]));
    // 同社区同色（社区 0 三人组），异社区异色（社区 1）。
    expect(byName.get("JVM")!.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
    expect(byName.get("堆内存")!.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
    expect(byName.get("孤立概念")!.itemStyle.color).toBe(COMMUNITY_PALETTE[1]);
  });

  it("colors by type when colorBy=type（FNV 稳定哈希）", () => {
    const [series] = buildGraphSeries(NODES, EDGES, "type");
    const data = series.data as Array<{ name: string; itemStyle: { color: string } }>;
    const byName = new Map(data.map((d) => [d.name, d]));
    expect(byName.get("JVM")!.itemStyle.color).toBe(typeColor("组件"));
    expect(byName.get("堆内存")!.itemStyle.color).toBe(typeColor("概念"));
  });

  it("defaults to community coloring（spec §6：结构洞察优先）", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    const jvm = (series.data as Array<{ name: string; itemStyle: { color: string } }>).find((d) => d.name === "JVM")!;
    expect(jvm.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
  });
});

describe("matchEntityNames（搜索模糊匹配）", () => {
  it("matches case-insensitive substrings and preserves data order", () => {
    expect(matchEntityNames(NODES, "jvm")).toEqual(["JVM"]);
    expect(matchEntityNames(NODES, "内存")).toEqual(["堆内存"]);
  });

  it("returns [] for blank query and no-match", () => {
    expect(matchEntityNames(NODES, "")).toEqual([]);
    expect(matchEntityNames(NODES, "   ")).toEqual([]);
    expect(matchEntityNames(NODES, "不存在")).toEqual([]);
  });
});

describe("filterNeighborhood（局部图 N 跳裁剪）", () => {
  // 链式图：A — B — C — D（无向扩展；B 的一跳邻居={A,C}，两跳={A,C,D}）。
  const CHAIN_NODES = [node("A"), node("B"), node("C"), node("D")];
  const CHAIN_EDGES: KnowledgeGraphEdge[] = [
    { source: "A", target: "B", relation: "r", description: "" },
    { source: "B", target: "C", relation: "r", description: "" },
    { source: "C", target: "D", relation: "r", description: "" },
  ];

  it("keeps focus + direct neighbors at 1 hop（含邻居间边，裁掉远端）", () => {
    const { nodes: kept, edges: keptEdges } = filterNeighborhood(CHAIN_NODES, CHAIN_EDGES, "B", 1);
    expect(kept.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
    expect(keptEdges).toHaveLength(2); // A-B, B-C；C-D 出界
  });

  it("expands to second-degree neighbors at 2 hops", () => {
    const { nodes: kept, edges: keptEdges } = filterNeighborhood(CHAIN_NODES, CHAIN_EDGES, "B", 2);
    expect(kept).toHaveLength(4);
    expect(keptEdges).toHaveLength(3);
  });

  it("treats directed edges as undirected for neighborhood expansion", () => {
    // 反向边（target=焦点）同样算邻居——对齐 graph_search 的邻域语义。
    const { nodes: kept } = filterNeighborhood(CHAIN_NODES, CHAIN_EDGES, "A", 1);
    expect(kept.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("returns the focus alone when it is isolated / missing edges", () => {
    const { nodes: kept, edges: keptEdges } = filterNeighborhood(CHAIN_NODES, CHAIN_EDGES, "D", 0);
    expect(kept.map((n) => n.id)).toEqual(["D"]);
    expect(keptEdges).toHaveLength(0);
  });
});

describe("缩放分级标签（2026-08-19 标签密集治理，对齐 Neo4j Bloom/Gephi 惯例）", () => {
  it("classifies zoom into hidden / important / full tiers", () => {
    expect(labelTierForZoom(0.3)).toBe("hidden");
    expect(labelTierForZoom(LABEL_ZOOM_HIDE_BELOW - 0.01)).toBe("hidden");
    expect(labelTierForZoom(LABEL_ZOOM_HIDE_BELOW)).toBe("important"); // 边界归属中档
    expect(labelTierForZoom(0.75)).toBe("important");
    expect(labelTierForZoom(LABEL_ZOOM_FULL_ABOVE)).toBe("full"); // 边界归属全显
    expect(labelTierForZoom(1.6)).toBe("full");
  });

  it("labelTextForTier: full 档返回名称", () => {
    expect(labelTextForTier(NODES[0], "full", "JVM")).toBe("JVM");
    expect(labelTextForTier(NODES[1], "full", "堆内存")).toBe("堆内存");
  });

  it("labelTextForTier: important 档只返回 mention >= 阈值的节点名", () => {
    // NODES 里只有 JVM mention_count=9 >= IMPORTANT_MENTION_MIN，其余都是 1。
    expect(labelTextForTier(NODES[0], "important", "JVM")).toBe("JVM");
    expect(labelTextForTier(NODES[1], "important", "堆内存")).toBe("");
    expect(labelTextForTier(NODES[3], "important", "孤立概念")).toBe("");
    expect(IMPORTANT_MENTION_MIN).toBeGreaterThan(1); // 阈值语义钉住：>1 才算重要
    // node 缺失（防御）：回退到 mention=0 判定 → 隐藏。
    expect(labelTextForTier(undefined, "important", "某某")).toBe("");
  });

  it("labelTextForTier: hidden 档全部返回空串（hover emphasis 仍可见单个）", () => {
    expect(labelTextForTier(NODES[0], "hidden", "JVM")).toBe("");
  });

  it("buildGraphSeries 启用 hideOverlap 防重叠 + scaleLimit 防失控", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    expect(series.labelLayout).toEqual({ hideOverlap: true });
    expect(series.scaleLimit).toEqual({ min: 0.3, max: 3 });
  });
});

// ── Task 5（P4，spec §7 · 2026-08-20 两层合并重设计）：检索路径叠加 ────────
// 叠加层是诊断镜头，不破坏底图编码：填充色一律保留（类型/社区语义），层语义由
// 描边+发光+尺寸承载，视觉只分两层——命中（种子∪证据，红发光描边，种子额外
// 放大）/ 路径（hop-1∪hop-2 扩展，金细边）；非命中节点原样（不灰化）；
// 命中路径边荧光金发光。徽标仍保留「种子 m · 扩展 n · 证据 k」三层数字分解。

// 叠加专用节点集：五节点覆盖全部角色——JVM 纯种子（红发光+放大）/ 堆内存纯
// hop-1（金边）/ 字节码纯 hop-2（同为金边，验 hop 合并）/ 类加载器 hop-1+证据
//（验命中优先于路径）/ 孤立概念不命中（验原样保留）。
const OVERLAY_NODES: KnowledgeGraphNode[] = [...NODES, node("类加载器", { community: 0 })];

// 叠加专用边集：JVM→堆内存 / JVM→字节码 两端都在 trace 内（路径边）；
// 堆内存→孤立概念 一端不在 trace（非路径边，验不染色）。
const OVERLAY_EDGES: KnowledgeGraphEdge[] = [
  ...EDGES,
  { source: "堆内存", target: "孤立概念", relation: "提及", description: "" },
];

const OVERLAY_TRACE: GraphRetrievalTrace = {
  seed_entities: ["JVM"],
  expanded_nodes: [
    { name: "堆内存", hop: 1 },
    { name: "字节码", hop: 2 },
    { name: "类加载器", hop: 1 },
  ],
  evidence_entities: ["类加载器"],
};

type OverlayDatum = {
  name: string;
  symbol?: string;
  symbolSize: number;
  itemStyle: {
    color: string;
    opacity?: number;
    borderColor?: string;
    borderWidth?: number;
    shadowColor?: string;
    shadowBlur?: number;
  };
};

type OverlayLink = {
  source: string;
  target: string;
  lineStyle?: { curveness?: number; color?: string; width?: number; opacity?: number; shadowColor?: string; shadowBlur?: number };
};

function dataByName(series: { data: unknown }): Map<string, OverlayDatum> {
  return new Map((series.data as OverlayDatum[]).map((datum) => [datum.name, datum]));
}

describe("buildGraphSeries overlay（P4 两层编码 · 命中 vs 路径）", () => {
  it("keeps every node's own fill and shape（底图语义不被叠加覆盖）", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const byName = dataByName(series);
    // 命中与非命中的填充色都保持社区色——层语义只允许走描边/发光/尺寸。
    expect(byName.get("JVM")!.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
    expect(byName.get("堆内存")!.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
    expect(byName.get("类加载器")!.itemStyle.color).toBe(COMMUNITY_PALETTE[0]);
    expect(byName.get("孤立概念")!.itemStyle.color).toBe(COMMUNITY_PALETTE[1]);
    for (const datum of series.data as OverlayDatum[]) {
      expect(datum.itemStyle.opacity).toBeUndefined(); // 禁止灰化
      expect(datum.symbol).toBeUndefined(); // 禁止星标等符号覆盖
    }
  });

  it("marks hit nodes (seeds ∪ evidence) with a red glowing border", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const byName = dataByName(series);
    expect(GRAPH_HIT_BORDER_COLOR).toBe("#f5222d"); // 命中红（发光描边）
    for (const name of ["JVM", "类加载器"]) {
      const hit = byName.get(name)!;
      expect(hit.itemStyle.borderColor).toBe(GRAPH_HIT_BORDER_COLOR);
      expect(hit.itemStyle.borderWidth).toBe(3);
      expect(hit.itemStyle.shadowColor).toBe(GRAPH_HIT_BORDER_COLOR);
      expect(hit.itemStyle.shadowBlur).toBeGreaterThan(0); // 发光
    }
    // 类加载器同时是 hop-1 与证据 → 命中红优先于路径金。
    expect(byName.get("类加载器")!.itemStyle.borderColor).not.toBe(GRAPH_EXPANSION_BORDER_COLOR);
  });

  it("enlarges only seeds among hit nodes（尺寸通道保留源头信号，不加新颜色）", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const byName = dataByName(series);
    expect(byName.get("JVM")!.symbolSize).toBeGreaterThan(nodeSymbolSize(9)); // 种子放大
    // 类加载器是证据但非种子 → 不放大。
    expect(byName.get("类加载器")!.symbolSize).toBe(nodeSymbolSize(1));
  });

  it("rings all expansion nodes in one gold（hop-1/hop-2 合并，无发光）", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const byName = dataByName(series);
    expect(GRAPH_EXPANSION_BORDER_COLOR).toBe("#ffd700"); // 路径金（与路径边同色）
    for (const name of ["堆内存", "字节码"]) {
      const path = byName.get(name)!;
      expect(path.itemStyle.borderColor).toBe(GRAPH_EXPANSION_BORDER_COLOR); // hop-1/hop-2 同色
      expect(path.itemStyle.borderWidth).toBe(2);
      expect(path.itemStyle.shadowBlur).toBeUndefined(); // 路径层不发光（弱于命中）
      expect(path.symbolSize).toBe(nodeSymbolSize(1)); // 不放大
    }
  });

  it("leaves uninvolved nodes completely untouched（非命中不灰化不描边）", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const isolated = dataByName(series).get("孤立概念")!;
    expect(isolated.itemStyle).toEqual({ color: COMMUNITY_PALETTE[1] }); // 只有原色
    expect(isolated.symbolSize).toBe(nodeSymbolSize(1));
  });

  it("shows a seed without evidence as a hit（落地未产出证据仍可见）", () => {
    const landedOnly: GraphRetrievalTrace = {
      seed_entities: ["JVM"],
      expanded_nodes: [],
      evidence_entities: [],
    };
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", landedOnly);
    const jvm = dataByName(series).get("JVM")!;
    expect(jvm.itemStyle.borderColor).toBe(GRAPH_HIT_BORDER_COLOR);
    expect(jvm.symbolSize).toBeGreaterThan(nodeSymbolSize(9));
  });

  it("highlights in-path edges with fluorescent gold glow, others untouched", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", OVERLAY_TRACE);
    const links = series.links as OverlayLink[];
    const path = links.find((link) => link.source === "JVM" && link.target === "堆内存")!;
    expect(path.lineStyle?.color).toBe(GRAPH_PATH_COLOR);
    expect(GRAPH_PATH_COLOR).toBe("#ffd700"); // 荧光金
    expect(path.lineStyle?.width).toBe(2);
    expect(path.lineStyle?.shadowColor).toBe(GRAPH_PATH_COLOR);
    expect(path.lineStyle?.shadowBlur).toBeGreaterThan(0);
    expect(path.lineStyle?.opacity).toBeUndefined(); // 路径边不淡化
    const offPath = links.find((link) => link.target === "孤立概念")!;
    expect(offPath.lineStyle?.color).toBeUndefined();
    expect(offPath.lineStyle?.width).toBeUndefined();
    expect(offPath.lineStyle?.opacity).toBeUndefined();
    expect(offPath.lineStyle?.shadowBlur).toBeUndefined();
  });

  it("keeps the base encoding untouched without an overlay（回归钉死）", () => {
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", null);
    const jvm = dataByName(series).get("JVM")!;
    expect(jvm.symbol).toBeUndefined();
    expect(jvm.itemStyle).toEqual({ color: COMMUNITY_PALETTE[0] });
    expect(jvm.symbolSize).toBe(nodeSymbolSize(9));
    for (const link of series.links as OverlayLink[]) {
      expect(link.lineStyle?.color).toBeUndefined();
      expect(link.lineStyle?.opacity).toBeUndefined();
      expect(link.lineStyle?.shadowBlur).toBeUndefined();
    }
  });

  it("ignores trace names that no longer exist in the graph（陈旧 trace 容错）", () => {
    const stale: GraphRetrievalTrace = {
      seed_entities: ["已删除实体"],
      expanded_nodes: [{ name: "也没有", hop: 1 }],
      evidence_entities: ["已删除实体"],
    };
    const [series] = buildGraphSeries(OVERLAY_NODES, OVERLAY_EDGES, "community", stale);
    // 叠加激活但全部未命中 → 全图原样（不灰化不描边），不炸不抛错。
    for (const datum of series.data as OverlayDatum[]) {
      expect(datum.itemStyle.opacity).toBeUndefined();
      expect(datum.itemStyle.borderColor).toBeUndefined();
    }
    for (const link of series.links as OverlayLink[]) {
      expect(link.lineStyle?.color).toBeUndefined();
    }
  });
});

describe("widenRoamPointerChecker（2026-08-20 圈外拖拽修复）", () => {
  it("覆盖 chart._chartsViews 的 controller checker 为恒 true", () => {
    const setPointerCheckerCalls: Array<() => boolean> = [];
    const fakeChart = {
      _chartsViews: [
        {
          _controller: {
            setPointerChecker(checker: () => boolean) {
              setPointerCheckerCalls.push(checker);
            },
          },
        },
      ],
    };
    widenRoamPointerChecker(fakeChart);
    expect(setPointerCheckerCalls).toHaveLength(1);
    expect(setPointerCheckerCalls[0]!()).toBe(true);
  });

  it("chart 无 _chartsViews 时静默返回不炸", () => {
    expect(() => widenRoamPointerChecker({})).not.toThrow();
    expect(() => widenRoamPointerChecker(null)).not.toThrow();
  });
});
