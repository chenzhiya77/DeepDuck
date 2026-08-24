/**
 * eval-metrics-overview.utils pure-function tests (spec 2026-08-24 §3.3/§3.4, plan Task 2).
 *
 * getCellColorClass: Layer 1 Recall@k 单元格三态着色——阈值来自后端
 * `baseline_diff.threshold_percent`（CI 门禁同源），绝不硬编码。
 * getProgressBarColor: Layer 2 卡片进度条三档着色（语义 CSS 变量）。
 */
import { describe, expect, it } from "@rstest/core";

import { getCellColorClass, getProgressBarColor } from "@/components/workspace/knowledge/eval-metrics-overview.utils";

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
  it("returns muted for null values (metric not produced)", () => {
    expect(getProgressBarColor(null)).toBe("bg-muted");
  });

  it("returns ok for values >= 0.8 (boundary inclusive)", () => {
    expect(getProgressBarColor(0.8)).toBe("bg-(--eval-ok)");
    expect(getProgressBarColor(0.97)).toBe("bg-(--eval-ok)");
  });

  it("returns warn for 0.6 <= value < 0.8", () => {
    expect(getProgressBarColor(0.6)).toBe("bg-(--eval-warn)");
    expect(getProgressBarColor(0.79)).toBe("bg-(--eval-warn)");
  });

  it("returns danger below 0.6", () => {
    expect(getProgressBarColor(0.59)).toBe("bg-(--eval-danger)");
    expect(getProgressBarColor(0)).toBe("bg-(--eval-danger)");
  });
});
