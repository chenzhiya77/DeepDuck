/**
 * 思考开关的三种写法（spec 2026-09-21 model-entry-field-parity §3.3 / D3）：
 * 名字↔形状的对照表 + 生成（保存时写进 payload）+ 反推（打开弹窗时回显）。
 *
 * 钉死：三个形状的字面量**逐字对齐后端钉子** `backend/tests/test_model_factory.py::_THINKING_SHAPES`
 * （拼写漂了单测各绿、只有真栈能发现）；`anthropic` / `deepseek` 按类自动推、用户无需操作，
 * `openai-compatible` 背后可能是任何东西 ⇒ 只有它需要用户选；「不设置」⇒ 两个键都不写（不是 `null`）；
 * 反推未命中三个字面量 ⇒ 落「不设置」且**原样保留**（保存时带回去，不能推成 `undefined` ⇒ 那等于删）。
 */
import { describe, expect, it } from "@rstest/core";

import {
  THINKING_SHAPE_OPTIONS,
  apiTypeToUseResponsesApi,
  autoThinkingShape,
  thinkingRecipeFor,
  thinkingShapeFromEntry,
} from "@/core/models/thinking-shape";
import type { ManagedModel } from "@/core/models/types";

/** 形状① — OpenAI 兼容网关（我们选的默认形状）。 */
const GATEWAY = {
  when_thinking_enabled: { extra_body: { thinking: { type: "enabled" } } },
  when_thinking_disabled: { extra_body: { thinking: { type: "disabled" } } },
};

/** 形状② — vLLM / SGLang（chat template 变量透传）。 */
const VLLM = {
  when_thinking_enabled: {
    extra_body: { chat_template_kwargs: { enable_thinking: true } },
  },
  when_thinking_disabled: {
    extra_body: { chat_template_kwargs: { enable_thinking: false } },
  },
};

/** 形状③ — 原生 Anthropic（`budget_tokens` 与向导同一个值）。 */
const ANTHROPIC = {
  when_thinking_enabled: {
    thinking: { type: "enabled", budget_tokens: 4096 },
  },
  when_thinking_disabled: { thinking: { type: "disabled" } },
};

describe("thinkingRecipeFor", () => {
  it("shape ① writes extra_body.thinking for the OpenAI-compatible gateway", () => {
    expect(thinkingRecipeFor("openai-compatible", "gateway")).toEqual(GATEWAY);
  });

  it("shape ② writes chat_template_kwargs.enable_thinking for vLLM / SGLang", () => {
    expect(thinkingRecipeFor("openai-compatible", "vllm")).toEqual(VLLM);
  });

  it("shape ③ writes native thinking with budget_tokens exactly 4096", () => {
    const recipe = thinkingRecipeFor("openai-compatible", "anthropic");

    expect(recipe).toEqual(ANTHROPIC);
    expect(
      (recipe.when_thinking_enabled as { thinking: { budget_tokens: number } })
        .thinking.budget_tokens,
    ).toBe(4096);
  });

  it("pins anthropic / deepseek to their own shape without asking the user", () => {
    // The pick is irrelevant for these two: their class decides the spelling.
    expect(thinkingRecipeFor("anthropic", "none")).toEqual(ANTHROPIC);
    expect(thinkingRecipeFor("deepseek", "none")).toEqual(GATEWAY);
  });

  it("writes neither key for 不设置", () => {
    const recipe = thinkingRecipeFor("openai-compatible", "none");

    expect("when_thinking_enabled" in recipe).toBe(false);
    expect("when_thinking_disabled" in recipe).toBe(false);
  });

  it("carries a hand-written recipe back untouched instead of dropping it", () => {
    const handWritten = {
      when_thinking_enabled: {
        extra_body: { thinking: { type: "enabled", budget_tokens: 2048 } },
      },
    };

    expect(thinkingRecipeFor("openai-compatible", "none", handWritten)).toEqual(
      handWritten,
    );
  });
});

describe("autoThinkingShape", () => {
  it("names the shape of the two curated providers whose class decides it", () => {
    expect(autoThinkingShape("anthropic")).toBe("anthropic");
    expect(autoThinkingShape("deepseek")).toBe("gateway");
  });

  it("asks the user for openai-compatible — the id covers anything", () => {
    expect(autoThinkingShape("openai-compatible")).toBeNull();
  });

  it("asks the user for a provider the allowlist does not name", () => {
    expect(autoThinkingShape(null)).toBeNull();
    expect(autoThinkingShape("langchain_ollama:ChatOllama")).toBeNull();
  });
});

describe("thinkingShapeFromEntry", () => {
  it.each([
    ["gateway", GATEWAY],
    ["vllm", VLLM],
    ["anthropic", ANTHROPIC],
  ])("recognises the %s literal", (shape, recipe) => {
    expect(thinkingShapeFromEntry(recipe)).toEqual({
      shape,
      preserve: false,
    });
  });

  it("falls back to 不设置 and marks a recipe matching no literal as preserved", () => {
    const handWritten = {
      when_thinking_enabled: {
        extra_body: { thinking: { type: "enabled", budget_tokens: 2048 } },
      },
      when_thinking_disabled: {
        extra_body: { thinking: { type: "disabled" } },
      },
    };

    expect(thinkingShapeFromEntry(handWritten)).toEqual({
      shape: "none",
      preserve: true,
    });
  });

  it("reads an entry that never declared a recipe as 不设置 with nothing to preserve", () => {
    expect(thinkingShapeFromEntry({})).toEqual({
      shape: "none",
      preserve: false,
    });
  });

  it("reads an entry from the admin API (nulls included) the same way", () => {
    const model = {
      when_thinking_enabled: ANTHROPIC.when_thinking_enabled,
      when_thinking_disabled: null,
    } as Pick<ManagedModel, "when_thinking_enabled" | "when_thinking_disabled">;

    expect(thinkingShapeFromEntry(model)).toEqual({
      shape: "anthropic",
      preserve: false,
    });
  });
});

describe("THINKING_SHAPE_OPTIONS", () => {
  it("offers exactly the three shapes a user can pick", () => {
    expect(THINKING_SHAPE_OPTIONS).toEqual(["none", "gateway", "vllm"]);
  });
});

describe("apiTypeToUseResponsesApi", () => {
  it("writes true for Responses and nothing at all for Chat", () => {
    expect(apiTypeToUseResponsesApi("responses")).toBe(true);
    expect(apiTypeToUseResponsesApi("chat")).toBeUndefined();
  });

  it("never produces false — an absent key and an explicit false are different files", () => {
    // `false is not None` on the backend, so a false here would be written into the
    // file and the entry would stop being byte-stable (spec 2026-09-21 D6).
    for (const picked of ["chat", "responses", undefined] as const) {
      expect(apiTypeToUseResponsesApi(picked)).not.toBe(false);
    }
  });
});
