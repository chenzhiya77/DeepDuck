/**
 * 批量添加展开（spec 2026-09-10 §5.3.1，plan Task 4 seam C）：
 * 一把凭证 + N 个 Model ID → N 条扁平 entry（客户端展开，后端契约不变）。
 * 钉死：命名=Model ID、display_name 默认=Model ID、重名 -2/-3 去重、
 * 共享 api_key/endpoint/provider/能力、空 Model ID 跳过、
 * use_responses_api 仅 openai-compatible + Responses 时为 true、
 * 思考配方按 provider 生成（anthropic / deepseek 自动推，「不设置」⇒ 两个键都不写）、
 * 请求头逐条进 entry（没填 ⇒ 键不存在，不是 `{}`）。
 */
import { describe, expect, it } from "@rstest/core";

import { expandBatchToEntries, headersToRecord } from "@/core/models/batch";

describe("expandBatchToEntries", () => {
  it("expands two model ids sharing one credential into two entries", () => {
    const entries = expandBatchToEntries(
      {
        provider: "openai-compatible",
        apiKey: "sk-shared",
        endpoint: "https://api.example/v1",
      },
      ["model-a", "model-b"],
      [],
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      provider: "openai-compatible",
      name: "model-a",
      model: "model-a",
      display_name: "model-a",
      api_key: "sk-shared",
      endpoint: "https://api.example/v1",
    });
    expect(entries[1]).toMatchObject({ name: "model-b", api_key: "sk-shared" });
  });

  it("dedupes against existing names and within the batch using -2/-3", () => {
    const entries = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k" },
      ["model-a", "model-a"],
      ["model-a"],
    );

    expect(entries.map((e) => e.name)).toEqual(["model-a-2", "model-a-3"]);
  });

  it("skips empty and whitespace-only model ids", () => {
    const entries = expandBatchToEntries(
      { provider: "anthropic", apiKey: "k" },
      ["", "   ", "x"],
      [],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("x");
  });

  it("sets use_responses_api only for openai-compatible + responses", () => {
    const openai = expandBatchToEntries(
      { provider: "openai-compatible", apiKey: "k", apiType: "responses" },
      ["m"],
      [],
    );
    expect(openai[0]!.use_responses_api).toBe(true);

    const deepseek = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k", apiType: "responses" },
      ["m"],
      [],
    );
    expect(deepseek[0]!.use_responses_api).toBeUndefined();

    const chat = expandBatchToEntries(
      { provider: "openai-compatible", apiKey: "k", apiType: "chat" },
      ["m"],
      [],
    );
    expect(chat[0]!.use_responses_api).toBeUndefined();
  });

  it("applies shared capabilities and context window to every entry", () => {
    const entries = expandBatchToEntries(
      {
        provider: "openai-compatible",
        apiKey: "k",
        supportsThinking: true,
        supportsVision: true,
        defaultWindow: 128000,
      },
      ["a", "b"],
      [],
    );

    for (const entry of entries) {
      expect(entry.supports_thinking).toBe(true);
      expect(entry.supports_vision).toBe(true);
      expect(entry.context_window).toBe(128000);
    }
  });

  it("writes the thinking shape the provider decides on its own", () => {
    const anthropic = expandBatchToEntries(
      { provider: "anthropic", apiKey: "k" },
      ["m"],
      [],
    );
    expect(anthropic[0]!.when_thinking_enabled).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
    expect(anthropic[0]!.when_thinking_disabled).toEqual({
      thinking: { type: "disabled" },
    });

    const deepseek = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k" },
      ["m"],
      [],
    );
    expect(deepseek[0]!.when_thinking_enabled).toEqual({
      extra_body: { thinking: { type: "enabled" } },
    });
  });

  it("writes the picked shape for openai-compatible and nothing for 不设置", () => {
    const picked = expandBatchToEntries(
      { provider: "openai-compatible", apiKey: "k", thinkingShape: "vllm" },
      ["m"],
      [],
    );
    expect(picked[0]!.when_thinking_enabled).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: true } },
    });
    expect(picked[0]!.when_thinking_disabled).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });

    const unset = expandBatchToEntries(
      { provider: "openai-compatible", apiKey: "k" },
      ["m"],
      [],
    );
    expect("when_thinking_enabled" in unset[0]!).toBe(false);
    expect("when_thinking_disabled" in unset[0]!).toBe(false);
  });

  it("passes the endpoint through unchanged for every provider", () => {
    const entries = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k", endpoint: "https://ds.example" },
      ["m"],
      [],
    );
    expect(entries[0]!.endpoint).toBe("https://ds.example");
  });

  it("carries the request headers into every entry, and omits the key when unset", () => {
    const shared = { "x-opencode-session": "sess-1" };
    const withHeaders = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k", defaultHeaders: shared },
      ["model-a", "model-b"],
      [],
    );
    expect(withHeaders[0]!.default_headers).toEqual(shared);
    expect(withHeaders[1]!.default_headers).toEqual(shared);

    const without = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k" },
      ["m"],
      [],
    );
    expect("default_headers" in without[0]!).toBe(false);
  });
});

describe("headersToRecord", () => {
  it("turns trimmed rows into the stored record", () => {
    expect(
      headersToRecord([
        { name: " x-opencode-session ", value: " sess-1 " },
        { name: "X-Trace", value: "" },
      ]),
    ).toEqual({ "x-opencode-session": "sess-1", "X-Trace": "" });
  });

  it("drops nameless rows and returns undefined when nothing is left", () => {
    // `undefined` rather than `{}`: the backend drops unset keys, while `{}` would be
    // written into the file as an empty object.
    expect(headersToRecord([{ name: "  ", value: "orphan" }])).toBeUndefined();
    expect(headersToRecord([])).toBeUndefined();
  });
});
