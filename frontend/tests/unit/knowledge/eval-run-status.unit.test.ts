/**
 * eval-run-status pure-function tests (spec 2026-09-06 run-progress §4/§5).
 *
 * 覆盖运行进度纯函数：questions 段定长（progressLabel / progressFraction 出 k/N
 * 与百分比宽），layer1·ragas 段不定长（isIndeterminatePhase=true，progressLabel/
 * progressFraction 返回 null，前端走 pulse 而非假百分比），以及 aria 文案组装
 * （phase 词 + failed>0 后缀）。progress 为 null（运行中但首个轮询未到）时全部
 * 安全降级为不定长。
 */
import { describe, expect, it } from "@rstest/core";

import {
  isIndeterminatePhase,
  progressAriaLabel,
  progressFraction,
  progressLabel,
} from "@/core/knowledge/eval-run-status";
import type { EvalRunProgress } from "@/core/knowledge/types";

function progress(overrides: Partial<EvalRunProgress> = {}): EvalRunProgress {
  return {
    run_id: "run-1",
    phase: "questions",
    done: 3,
    total: 10,
    failed: 0,
    started_at: "2026-09-06T10:00:00+00:00",
    updated_at: "2026-09-06T10:05:00+00:00",
    ...overrides,
  };
}

const LABELS = {
  phaseLayer1: "检索评测",
  phaseQuestions: "答题",
  phaseRagas: "生成质量评估",
  failedCount: (n: number) => `失败 ${n}`,
};

describe("progressLabel", () => {
  it("returns done/total only for the determinate questions phase", () => {
    expect(progressLabel(progress())).toEqual({ done: 3, total: 10 });
  });

  it("returns null for indeterminate phases (layer1 / ragas)", () => {
    expect(progressLabel(progress({ phase: "layer1" }))).toBeNull();
    expect(progressLabel(progress({ phase: "ragas" }))).toBeNull();
  });

  it("returns null when there is no live progress", () => {
    expect(progressLabel(null)).toBeNull();
    expect(progressLabel(undefined)).toBeNull();
  });
});

describe("isIndeterminatePhase", () => {
  it("is determinate only for the questions phase", () => {
    expect(isIndeterminatePhase(progress())).toBe(false);
  });

  it("is indeterminate for layer1 / ragas / null (pulse, never a faked %)", () => {
    expect(isIndeterminatePhase(progress({ phase: "layer1" }))).toBe(true);
    expect(isIndeterminatePhase(progress({ phase: "ragas" }))).toBe(true);
    expect(isIndeterminatePhase(null)).toBe(true);
  });
});

describe("progressFraction", () => {
  it("computes done/total clamped to 0..1 for the questions phase", () => {
    expect(progressFraction(progress({ done: 3, total: 10 }))).toBeCloseTo(0.3);
    expect(progressFraction(progress({ done: 0, total: 10 }))).toBe(0);
    expect(progressFraction(progress({ done: 10, total: 10 }))).toBe(1);
  });

  it("clamps an over-count done to 1 (defensive)", () => {
    expect(progressFraction(progress({ done: 12, total: 10 }))).toBe(1);
  });

  it("returns null for indeterminate phases or a non-positive total", () => {
    expect(progressFraction(progress({ phase: "ragas" }))).toBeNull();
    expect(progressFraction(progress({ total: 0 }))).toBeNull();
    expect(progressFraction(null)).toBeNull();
  });
});

describe("progressAriaLabel", () => {
  it("maps each phase to its word", () => {
    expect(progressAriaLabel(progress({ phase: "layer1" }), LABELS)).toBe("检索评测");
    expect(progressAriaLabel(progress({ phase: "questions" }), LABELS)).toBe("答题");
    expect(progressAriaLabel(progress({ phase: "ragas" }), LABELS)).toBe("生成质量评估");
  });

  it("appends the failed suffix only when failed > 0", () => {
    expect(progressAriaLabel(progress({ failed: 0 }), LABELS)).toBe("答题");
    expect(progressAriaLabel(progress({ failed: 2 }), LABELS)).toBe("答题，失败 2");
  });

  it("returns null when there is no live progress", () => {
    expect(progressAriaLabel(null, LABELS)).toBeNull();
  });
});
