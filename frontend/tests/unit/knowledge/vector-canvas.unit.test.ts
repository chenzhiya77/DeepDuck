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
  buildTooltipHtml,
  DIMMED_OPACITY,
  isPointDimmed,
  TOOLTIP_LABEL_MAX,
  TOOLTIP_PREVIEW_MAX,
} from "@/components/workspace/knowledge/vector-canvas";
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
