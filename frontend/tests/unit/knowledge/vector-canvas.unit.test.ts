/**
 * 向量空间聚焦淡化纯函数（2026-08-15 聚焦交互，用户拍板）：
 * - hover 切片 → 同文档切片保持，其余文档切片淡出；实体/wiki/卡片
 *   （跨文档参照系）不淡出；
 * - hover 实体/wiki/卡片 → 该大类保持，其余所有（含切片）淡出；
 * - 搜索锁定（docSearch）→ 匹配文档切片保持，其余切片淡出；
 * - 淡化 = 低透明度保留原色（保空间参照，不隐藏）。
 */
import { describe, expect, it } from "@rstest/core";

import {
  buildOverlaySeries,
  buildSeriesOptions,
  buildTooltipHtml,
  DIMMED_OPACITY,
  isPointDimmed,
  OVERLAY_LINE_SLOTS,
  OVERLAY_QUERY_COLOR,
  overlayHitColor,
  TOOLTIP_LABEL_MAX,
  TOOLTIP_PREVIEW_MAX,
} from "@/components/workspace/knowledge/vector-canvas";
import type { VectorSeriesGroup } from "@/components/workspace/knowledge/vector-tab";
import type { VectorProjectionPoint } from "@/core/knowledge/types";

function point(sourceType: string, colorKey: string): VectorProjectionPoint {
  return {
    id: `${colorKey}#0`,
    source_type: sourceType,
    x: 0,
    y: 0,
    label: "label",
    color_key: colorKey,
  };
}

describe("isPointDimmed 聚焦淡化判定", () => {
  it("dims nothing when there is no focus", () => {
    expect(isPointDimmed(point("chunk", "doc-1"), null)).toBe(false);
    expect(isPointDimmed(point("entity", "概念"), null)).toBe(false);
  });

  it("document focus: only other documents' chunks dim; entity/wiki/card stay", () => {
    const focus = { kind: "document", docId: "doc-1" } as const;
    expect(isPointDimmed(point("chunk", "doc-1"), focus)).toBe(false);
    expect(isPointDimmed(point("chunk", "doc-2"), focus)).toBe(true);
    // 跨文档参照系不淡出
    expect(isPointDimmed(point("entity", "概念"), focus)).toBe(false);
    expect(isPointDimmed(point("wiki", "wiki"), focus)).toBe(false);
    expect(isPointDimmed(point("card", "card"), focus)).toBe(false);
  });

  it("collection focus: everything outside the focused collection dims (chunks included)", () => {
    const focus = { kind: "collection", sourceType: "entity" } as const;
    expect(isPointDimmed(point("entity", "概念"), focus)).toBe(false);
    expect(isPointDimmed(point("chunk", "doc-1"), focus)).toBe(true);
    expect(isPointDimmed(point("wiki", "wiki"), focus)).toBe(true);
    expect(isPointDimmed(point("card", "card"), focus)).toBe(true);
  });

  it("docSearch focus: chunks of non-matching documents dim; other types stay", () => {
    const focus = { kind: "docSearch", docIds: new Set(["doc-1", "doc-3"]) } as const;
    expect(isPointDimmed(point("chunk", "doc-1"), focus)).toBe(false);
    expect(isPointDimmed(point("chunk", "doc-3"), focus)).toBe(false);
    expect(isPointDimmed(point("chunk", "doc-2"), focus)).toBe(true);
    expect(isPointDimmed(point("entity", "概念"), focus)).toBe(false);
  });

  it("exposes a subtle dimming opacity (fade, not hide)", () => {
    expect(DIMMED_OPACITY).toBeGreaterThan(0);
    expect(DIMMED_OPACITY).toBeLessThanOrEqual(0.2);
  });
});

// ── hover tooltip（2026-08-17）：短文案 + 防遮挡 ───────────────────────────

describe("buildTooltipHtml 悬浮提示", () => {
  it("renders label and preview on two lines when both are short", () => {
    const html = buildTooltipHtml("a.pdf", "第一章切片");
    expect(html).toContain("a.pdf");
    expect(html).toContain("第一章切片");
    expect(html).toContain("<br/>");
  });

  it("truncates long label and preview with an ellipsis", () => {
    const html = buildTooltipHtml("文".repeat(30), "摘".repeat(30));
    expect(html).toContain(`${"文".repeat(TOOLTIP_LABEL_MAX)}…`);
    expect(html).toContain(`${"摘".repeat(TOOLTIP_PREVIEW_MAX)}…`);
    expect(html).not.toContain("文".repeat(21));
  });

  it("renders label only when preview is missing", () => {
    expect(buildTooltipHtml("JVM", undefined)).toBe("JVM");
    expect(buildTooltipHtml("JVM", "")).toBe("JVM");
  });

  it("escapes HTML in label and preview", () => {
    const html = buildTooltipHtml("<b>x</b>", "<script>alert(1)</script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

// ── P6 检索联动叠加渲染（2026-08-15 spec §9）──────────────────────────────

function chunkPoint(id: string, colorKey: string, x = 0.1, y = 0.2): VectorProjectionPoint {
  return { id, source_type: "chunk", x, y, label: "a.pdf", color_key: colorKey };
}

const OVERLAY = {
  query: { x: 0.11, y: 0.22, label: "Gateway 职责" },
  hits: [
    { pointId: "c1", score: 0.97 },
    { pointId: "c2", score: null },
    { pointId: "missing", score: 0.5 }, // 不在投影中 → 跳过
  ],
};

const ALPHA_SUFFIX = /([\d.]+)\)$/;
/** 从 rgba() 颜色字符串取 alpha 通道值。 */
const alphaOf = (color: string) => Number(ALPHA_SUFFIX.exec(color)?.[1]);

describe("overlayHitColor 命中色深", () => {
  it("interpolates opacity by normalized score: min → lightest, max → full", () => {
    const light = overlayHitColor(0.2, 0.2, 0.8);
    const full = overlayHitColor(0.8, 0.2, 0.8);
    expect(light).not.toBe(full);
    expect(alphaOf(light)).toBeLessThan(alphaOf(full));
    expect(alphaOf(full)).toBe(1);
  });

  it("lands mid-scale for a null score (rerank-degraded hit)", () => {
    const mid = overlayHitColor(null, 0.2, 0.8);
    expect(alphaOf(mid)).toBeGreaterThan(alphaOf(overlayHitColor(0.2, 0.2, 0.8)));
    expect(alphaOf(mid)).toBeLessThan(1);
  });

  it("collapses to the deepest shade when all scores are equal", () => {
    expect(alphaOf(overlayHitColor(0.5, 0.5, 0.5))).toBe(1);
  });
});

describe("buildOverlaySeries 检索叠加", () => {
  const POINTS = [chunkPoint("c1", "doc-1", 0.1, 0.2), chunkPoint("c2", "doc-2", 0.9, 0.8)];

  it("renders the query as a translucent star on the X-Z plane in 2D", () => {
    const [querySeries] = buildOverlaySeries(OVERLAY, POINTS, 2);
    expect(querySeries.type).toBe("scatter3D");
    // 五角星（自定义 SVG path，辨识度最高；与四类 collection 形状全不撞）
    expect(String(querySeries.symbol)).toContain("path://");
    expect(querySeries.symbolSize).toBeGreaterThan(12);
    expect(querySeries.itemStyle.color).toBe(OVERLAY_QUERY_COLOR);
    // 透明一档：隐约透出被盖住的点，不再实心遮挡
    expect(querySeries.itemStyle.opacity).toBeLessThan(1);
    expect(querySeries.data).toEqual([{ value: [0.11, 0, 0.22] }]); // 2D = X-Z 立面
  });

  it("links the query to every hit present in the projection, skipping missing ones", () => {
    const [, ...lines] = buildOverlaySeries(OVERLAY, POINTS, 2);
    // 关键配置钉住：连线走 line3D（默认 cartesian3D）；勿用 lines3D——其 layout
    // 只支持 globe/geo3D/mapbox3D，cartesian3D 下静默跳过 → 渲染期炸「reading '0'」。
    expect(lines[0]?.type).toBe("line3D");
    expect(lines[0]?.coordinateSystem).toBe("cartesian3D");
    // 2 个命中占槽位 0/1（missing 被跳过），其余槽位置空（恒定 20 槽 → merge 稳定）。
    expect(lines).toHaveLength(OVERLAY_LINE_SLOTS);
    expect(lines[0]?.data).toEqual([
      [0.11, 0, 0.22],
      [0.1, 0, 0.2],
    ]);
    expect(lines[1]?.data).toEqual([
      [0.11, 0, 0.22],
      [0.9, 0, 0.8],
    ]);
    expect(lines[2]?.data).toEqual([]);
  });

  it("uses true 3D coords (x, y, z) when dims=3", () => {
    const overlay3d = { ...OVERLAY, query: { ...OVERLAY.query, z: 0.33 } };
    const points3d = POINTS.map((p) => ({ ...p, z: p.x + 0.5 }));
    const [querySeries, ...lines] = buildOverlaySeries(overlay3d, points3d, 3);
    expect(querySeries.data).toEqual([{ value: [0.11, 0.22, 0.33] }]);
    expect(lines[0]?.data).toEqual([
      [0.11, 0.22, 0.33],
      [0.1, 0.2, 0.6],
    ]);
  });

  it("returns empty placeholder series for a null overlay (stable merge structure)", () => {
    // echarts merge 按索引合并 series 数组——叠加层恒定占位（data 空）才能让
    // 「清除叠加」可靠落图（数组变短时 merge 不保证删除尾部系列）。
    const [querySeries, ...lines] = buildOverlaySeries(null, POINTS, 2);
    expect(querySeries.data).toEqual([]);
    expect(lines).toHaveLength(OVERLAY_LINE_SLOTS);
    expect(lines.every((line) => line.data.length === 0)).toBe(true);
    expect(querySeries.silent).toBe(true);
  });
});

describe("buildSeriesOptions overlay 集成", () => {
  const groups: VectorSeriesGroup[] = [
    {
      key: "chunk",
      sourceType: "chunk",
      label: "切片",
      color: "#42a5f5",
      points: [chunkPoint("c1", "doc-1"), chunkPoint("c2", "doc-2")],
    },
  ];

  /** 合并所有主系列桶的数据项（同色系边界分桶：主系列被切成 HALO_BUCKETS 份）。 */
  function mainSeriesData(seriesOptions: ReturnType<typeof buildSeriesOptions>) {
    return seriesOptions
      .filter((s) => s.name === "切片")
      .flatMap(
        (s) =>
          (s as { data: Array<{ point: VectorProjectionPoint; itemStyle?: Record<string, unknown> }> }).data,
      );
  }

  it("highlights hit points at full opacity with the score-tinted overlay color", () => {
    // 仅 c1 命中的 overlay：c2 是未命中对照组，保持原色不覆写。
    const singleHit = { ...OVERLAY, hits: [{ pointId: "c1", score: 0.97 }] };
    const data = mainSeriesData(buildSeriesOptions(groups, 2, null, undefined, "#ffffff", singleHit));
    const hit = data.find((d) => d.point.id === "c1");
    const miss = data.find((d) => d.point.id === "c2");
    expect(hit?.itemStyle?.opacity).toBe(1);
    expect(String(hit?.itemStyle?.color)).toContain("245, 34, 45");
    expect(miss?.itemStyle?.color).toBeUndefined();
  });

  it("exempts hit points from focus dimming (the overlay target stays visible)", () => {
    // hover 聚焦 doc-1 时 doc-2 的切片本应淡化，但它是检索命中点 → 豁免。
    const focus = { kind: "document", docId: "doc-1" } as const;
    const data = mainSeriesData(buildSeriesOptions(groups, 2, focus, undefined, "#ffffff", OVERLAY));
    const hitOutsideFocus = data.find((d) => d.point.id === "c2");
    expect(hitOutsideFocus?.itemStyle?.opacity).toBe(1);
  });

  it("always appends the overlay series, even without an overlay (merge stability)", () => {
    const options = buildSeriesOptions(groups, 2, null, undefined, "#ffffff", null);
    const names = options.map((s) => s.name);
    expect(names).toContain("__overlay_query");
    expect(names).toContain("__overlay_line_0");
    expect(names).toContain(`__overlay_line_${OVERLAY_LINE_SLOTS - 1}`);
  });
});
