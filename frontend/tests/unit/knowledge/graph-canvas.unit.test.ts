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
  fnv1aHash,
  graphTooltipFormatter,
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

  it("encodes node size by √mention_count and color by type", () => {
    const [series] = buildGraphSeries(NODES, EDGES);
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
