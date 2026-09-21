/**
 * 「思考开关写法」下拉的显隐（spec 2026-09-21 §3.4 / D3）。
 *
 * 规则：只有 `openai-compatible` 需要用户选 —— 它背后可能是普通网关、也可能是自部署 vLLM；
 * `anthropic` / `deepseek` 由客户端类自动推，那一行**不出现**。
 *
 * 直接渲染 `ModelCapabilityEditor`、不经过弹窗、也不驱动 Radix `Select` —— 环比
 * `functional-models-view.dom.test.tsx`（其注释写明 "renders the view once with a different
 * stored provider **instead of driving the Radix dropdown** … keeps the test about the rule
 * rather than about Radix's portal behavior"）⇒ 每个假设各渲一次，断言只钉「那一行在不在」；
 * 开候选列表属于自找 flake（happy-dom 下 Portal 的挂载时机不可靠）。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { ModelCapabilityEditor } from "@/components/workspace/settings/model-capability-editor";
import { emptyCapabilityValue } from "@/core/models/capability";
import type { ProviderId } from "@/core/models/types";

/** Every label resolves to its own key, so an assertion can name the i18n key directly. */
const KEYS = new Proxy({} as Record<string, unknown>, {
  get: (_target, key) =>
    key === "subsetSelected"
      ? (count: number) => `${String(key)}(${count})`
      : String(key),
});

rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({ t: { settings: { models: KEYS }, inputBox: KEYS } }),
}));

function renderEditor(provider: ProviderId) {
  return render(
    <ModelCapabilityEditor
      provider={provider}
      value={emptyCapabilityValue()}
      onChange={rs.fn()}
      thinkingShape="none"
      onThinkingShapeChange={rs.fn()}
    />,
  );
}

describe("the thinking-shape row", () => {
  afterEach(cleanup);

  it("is offered for openai-compatible — that id covers anything", () => {
    renderEditor("openai-compatible");

    expect(screen.getByText("thinkingShape")).toBeTruthy();
    expect(screen.getByLabelText("thinkingShape")).toBeTruthy();
  });

  it.each<ProviderId>(["anthropic", "deepseek"])(
    "is absent for %s, whose class decides the shape",
    (provider) => {
      renderEditor(provider);

      expect(screen.queryByText("thinkingShape")).toBeNull();
      expect(screen.queryByLabelText("thinkingShape")).toBeNull();
    },
  );
});
