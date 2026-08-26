/**
 * eval-metrics-overview.utils pure-function tests (spec 2026-08-24 §3.3/§3.4, plan Task 2).
 *
 * getCellColorClass: Layer 1 Recall@k 单元格三态着色——阈值来自后端
 * `baseline_diff.threshold_percent`（CI 门禁同源），绝不硬编码。
 * getProgressBarColor: Layer 2 卡片进度条三档着色（语义 CSS 变量）。
 */
import { describe, expect, it } from "@rstest/core";

import { classifyRagasSkipReason, getCellColorClass, getProgressBarColor } from "@/components/workspace/knowledge/eval-metrics-overview.utils";

describe("classifyRagasSkipReason", () => {
  // 后端 ragas_unavailable_reason() 的固定常量前缀；分类只认前缀，不整串比对。
  it("classifies the backend not-installed constant as not-installed", () => {
    expect(classifyRagasSkipReason("ragas 未安装（可选依赖；`uv sync --extra ragas` 后可用）")).toBe("not-installed");
  });

  it("treats a missing reason as not-installed (defensive)", () => {
    expect(classifyRagasSkipReason(null)).toBe("not-installed");
    expect(classifyRagasSkipReason(undefined)).toBe("not-installed");
  });

  it("classifies execution failures and empty output as runtime errors", () => {
    expect(classifyRagasSkipReason("ragas 执行失败: ConnectionError(...)")).toBe("error");
    expect(classifyRagasSkipReason("ragas 未产出结果")).toBe("error");
  });
});

describe("getCellColorClass", () => {
  it("returns no tint when the run carried no baseline diff", () => {
    expect(getCellColorClass(null, 3.0)).toBe("");
    expect(getCellColorClass(undefined, 3.0)).toBe("");
    expect(getCellColorClass(-0.05, null)).toBe("");
    expect(getCellColorClass(-0.05, undefined)).toBe("");
  });

  it("returns no tint for improvements or zero delta", () => {
    expect(getCellColorClass(0.05, 3.0)).toBe("");
    expect(getCellColorClass(0, 3.0)).toBe("");
  });

  it("warns on a sub-threshold drop (boundary: -threshold < delta < 0)", () => {
    expect(getCellColorClass(-0.029, 3.0)).toBe("bg-(--eval-warn-bg) text-(--eval-warn-fg)");
    // 紧贴阈值内侧仍是警告（delta > -threshold）。
    expect(getCellColorClass(-0.0299, 3.0)).toBe("bg-(--eval-warn-bg) text-(--eval-warn-fg)");
  });

  it("marks danger at or beyond the threshold (boundary: delta <= -threshold)", () => {
    expect(getCellColorClass(-0.03, 3.0)).toBe("bg-(--eval-danger-bg) text-(--eval-danger-fg) font-semibold");
    expect(getCellColorClass(-0.08, 3.0)).toBe("bg-(--eval-danger-bg) text-(--eval-danger-fg) font-semibold");
  });

  it("honours a non-default threshold coming from the backend payload", () => {
    // 阈值不写死 3%：thresholdPercent=5 时 -4% 只是警告。
    expect(getCellColorClass(-0.04, 5.0)).toBe("bg-(--eval-warn-bg) text-(--eval-warn-fg)");
    expect(getCellColorClass(-0.05, 5.0)).toBe("bg-(--eval-danger-bg) text-(--eval-danger-fg) font-semibold");
  });
});

describe("getProgressBarColor", () => {
  // 完整字面量类：Tailwind 静态扫描只认源码里逐字出现的候选类，
  // 运行时拼接 `variant:${utility}` 在生产构建不会生成 CSS 规则。
  it("returns the full muted class for null values (metric not produced)", () => {
    expect(getProgressBarColor(null)).toBe("[&_[data-slot=progress-indicator]]:bg-muted");
  });

  it("returns the full ok-tier class for values >= 0.8 (boundary inclusive)", () => {
    expect(getProgressBarColor(0.8)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-ok)");
    expect(getProgressBarColor(0.97)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-ok)");
  });

  it("returns the full warn-tier class for 0.6 <= value < 0.8", () => {
    expect(getProgressBarColor(0.6)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-warn)");
    expect(getProgressBarColor(0.79)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-warn)");
  });

  it("returns the full danger-tier class below 0.6", () => {
    expect(getProgressBarColor(0.59)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-danger)");
    expect(getProgressBarColor(0)).toBe("[&_[data-slot=progress-indicator]]:bg-(--eval-danger)");
  });
});
