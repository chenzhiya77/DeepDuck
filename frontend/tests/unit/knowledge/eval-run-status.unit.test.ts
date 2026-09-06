/**
 * eval-run-status pure-function tests (spec 2026-09-06 run-progress §4/§5，
 * 2026-09-06 修订：按钮改阶段名 + n/3).
 *
 * 覆盖运行进度纯函数：phaseStep 把三段映射到 1/2/3（null/undefined 降级为 1，
 * 让触发瞬间即读「检索评测 1/3」）；progressFraction 只在 questions 段出定长
 * 百分比宽，layer1·ragas 段返回 null（isIndeterminatePhase=true，前端走 pulse
 * 而非假百分比）；以及 aria 文案组装（4 字 phase 词 + failed>0 后缀）。
 */
import { describe, expect, it } from "@rstest/core";

import {
  isIndeterminatePhase,
  phaseStep,
  progressAriaLabel,
  progressFraction,
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
  phaseQuestions: "答题评测",
  phaseRagas: "质量评估",
  failedCount: (n: number) => `失败 ${n}`,
};

describe("phaseStep", () => {
  it("maps each phase to its 1-based step in the 3-phase pipeline", () => {
    expect(phaseStep(progress({ phase: "layer1" }))).toBe(1);
    expect(phaseStep(progress({ phase: "questions" }))).toBe(2);
    expect(phaseStep(progress({ phase: "ragas" }))).toBe(3);
  });

  it("defaults to step 1 (layer1) when there is no live progress", () => {
    // 触发瞬间乐观置位但首个轮询未到 → 按钮即读「检索评测 1/3」。
    expect(phaseStep(null)).toBe(1);
    expect(phaseStep(undefined)).toBe(1);
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
    expect(progressAriaLabel(progress({ phase: "questions" }), LABELS)).toBe("答题评测");
    expect(progressAriaLabel(progress({ phase: "ragas" }), LABELS)).toBe("质量评估");
  });

  it("appends the failed suffix only when failed > 0", () => {
    expect(progressAriaLabel(progress({ failed: 0 }), LABELS)).toBe("答题评测");
    expect(progressAriaLabel(progress({ failed: 2 }), LABELS)).toBe("答题评测，失败 2");
  });

  it("returns null when there is no live progress", () => {
    expect(progressAriaLabel(null, LABELS)).toBeNull();
  });
});
