/**
 * 输入栏推理深度/模式的纯规则（spec 2026-09-10 §5.3.2/§6 方案 A，plan Task 5 seam C node）：
 * - 模式可见性：`!supports_thinking` ⇒ 只剩闪速（thinking/pro/ultra 都是死条目）；
 * - 推理深度选项：模型声明子集 ⇒ 只列子集，未声明 ⇒ 全 4 档；
 * - 解析序（方案 A）：用户显式 > 模型默认（且必须 ∈ 子集）> 模式启发式；
 * - 切换模式：模型声明默认时不重写，未声明时保留既有启发式；
 * - 选中模型：预选该模型声明的默认档。
 */
import { describe, expect, it } from "@rstest/core";

import {
  effortAfterModeSelect,
  effortAfterModelSelect,
  INPUT_MODES,
  isModeOffered,
  modeHeuristicEffort,
  modelDefaultEffort,
  offeredModes,
  reasoningEffortLevels,
  resolveMode,
  resolveReasoningEffort,
} from "@/core/models/reasoning-effort";

describe("mode availability", () => {
  it("offers every mode for a thinking model", () => {
    expect(offeredModes(true)).toEqual([...INPUT_MODES]);
  });

  it("offers only flash without thinking support", () => {
    expect(offeredModes(false)).toEqual(["flash"]);
    for (const mode of INPUT_MODES) {
      expect(isModeOffered(mode, false)).toBe(mode === "flash");
    }
  });

  it("resolves an unsupported mode back to flash", () => {
    expect(resolveMode("ultra", false)).toBe("flash");
    expect(resolveMode("pro", true)).toBe("pro");
    expect(resolveMode(undefined, true)).toBe("pro");
    expect(resolveMode(undefined, false)).toBe("flash");
  });
});

describe("reasoning effort options", () => {
  it("lists every level when the model declares no subset", () => {
    expect(reasoningEffortLevels(undefined)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(
      reasoningEffortLevels({ supported_reasoning_efforts: null }),
    ).toHaveLength(4);
  });

  it("lists exactly the declared subset", () => {
    expect(
      reasoningEffortLevels({ supported_reasoning_efforts: ["low", "high"] }),
    ).toEqual(["low", "high"]);
  });
});

describe("effective reasoning effort (option A)", () => {
  const declaring = {
    reasoning_effort: "high" as const,
    supported_reasoning_efforts: ["low", "high"] as const,
  };

  it("prefers an explicit selection over the model default", () => {
    expect(
      resolveReasoningEffort({
        explicit: "low",
        model: declaring,
        mode: "pro",
      }),
    ).toBe("low");
  });

  it("falls back to the model default, then to the mode heuristic", () => {
    expect(
      resolveReasoningEffort({ model: declaring, mode: "flash" }),
    ).toBe("high");
    expect(resolveReasoningEffort({ mode: "ultra" })).toBe("high");
    expect(resolveReasoningEffort({ mode: "pro" })).toBe("medium");
    expect(resolveReasoningEffort({ mode: "thinking" })).toBe("low");
    expect(resolveReasoningEffort({ mode: "flash" })).toBeUndefined();
  });

  it("ignores a model default outside the declared subset", () => {
    expect(
      modelDefaultEffort({
        reasoning_effort: "minimal",
        supported_reasoning_efforts: ["low", "high"],
      }),
    ).toBeUndefined();
    expect(
      modelDefaultEffort({
        reasoning_effort: "minimal",
        supported_reasoning_efforts: ["minimal", "low"],
      }),
    ).toBe("minimal");
  });

  it("honours a default declared without a subset", () => {
    expect(modelDefaultEffort({ reasoning_effort: "medium" })).toBe("medium");
    expect(
      resolveReasoningEffort({ model: { reasoning_effort: "medium" }, mode: "ultra" }),
    ).toBe("medium");
  });
});

describe("mode switch and model switch", () => {
  const declaring = {
    reasoning_effort: "high" as const,
    supported_reasoning_efforts: ["high"] as const,
  };

  it("keeps the chosen level when the model declares a default", () => {
    // ultra would normally force "high", but the model's own level is authoritative.
    expect(effortAfterModeSelect("low", declaring, "ultra")).toBe("low");
    expect(effortAfterModeSelect(undefined, declaring, "ultra")).toBeUndefined();
  });

  it("keeps the legacy mode heuristic when no default is declared", () => {
    expect(modeHeuristicEffort("ultra")).toBe("high");
    expect(modeHeuristicEffort("pro")).toBe("medium");
    expect(modeHeuristicEffort("thinking")).toBe("low");
    expect(modeHeuristicEffort("flash")).toBeUndefined();
    expect(effortAfterModeSelect(undefined, undefined, "ultra")).toBe("high");
    expect(effortAfterModeSelect("low", { supported_reasoning_efforts: ["low"] }, "pro")).toBe(
      "medium",
    );
  });

  it("preselects the selected model's declared default", () => {
    expect(effortAfterModelSelect(undefined, declaring)).toBe("high");
    // Without a declared default the current value stands (it may be the user's).
    expect(effortAfterModelSelect("low", { reasoning_effort: null })).toBe("low");
    expect(effortAfterModelSelect("low", undefined)).toBe("low");
  });
});
