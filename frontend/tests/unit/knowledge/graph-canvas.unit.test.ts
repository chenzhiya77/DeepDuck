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
  buildGraphSeries,
  COMMUNITY_PALETTE,
  filterNeighborhood,
  fnv1aHash,
  graphTooltipFormatter,
  matchEntityNames,
  nodeSymbolSize,
  typeColor,
} from "@/components/workspace/knowledge/graph-canvas";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/core/knowledge/types";


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

  it("dims non-neighbors on hover via adjacency focus", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
    expect(series.emphasis?.focus).toBe("adjacency");
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
