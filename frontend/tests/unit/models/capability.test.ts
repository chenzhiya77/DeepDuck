/**
 * 模型能力层（spec 2026-09-10 §5.3.2，plan Task 3 seam C node）：
 * - capability-registry：已知 model id → 建议能力（窗口/强度子集 + 能力 chip）；未知 → 空；
 * - batch 展开：携带窗口/强度子集与默认，且**默认 ∈ 子集**（否则丢弃；未声明子集不改旧语义）；
 * - 词表常量与后端 `config/model_config.py` 对齐（200K/400K/1M；minimal/low/medium/high）；
 * - validate 客户端：POST + JSON body，失败映射为携带服务端 detail 的 ModelsConfigRequestError。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";

const fetchMock = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchMock.fetch }));

const {
  CONTEXT_WINDOW_OPTIONS,
  ModelsConfigRequestError,
  REASONING_EFFORT_LEVELS,
  validateModelsConfig,
} = await import("@/core/models/api");
import { expandBatchToEntries } from "@/core/models/batch";
import { suggestCapabilities } from "@/core/models/capability-registry";

const PROBE = {
  provider: "deepseek" as const,
  endpoint: "https://ds.example",
  api_key: "sk-probe",
  model: "deepseek-chat",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("capability vocabulary", () => {
  it("mirrors the backend context-window options and effort levels", () => {
    expect([...CONTEXT_WINDOW_OPTIONS]).toEqual([200_000, 400_000, 1_000_000]);
    expect([...REASONING_EFFORT_LEVELS]).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("suggestCapabilities", () => {
  it("suggests a 200K window plus vision/thinking for claude models", () => {
    const suggestion = suggestCapabilities("claude-sonnet-4-20250514");

    expect(suggestion.supported_context_windows).toEqual([200_000]);
    expect(suggestion.supports_vision).toBe(true);
    expect(suggestion.supports_thinking).toBe(true);
    // Anthropic's API takes a thinking budget, not OpenAI-style effort levels,
    // so no effort subset is claimed for it.
    expect(suggestion.supported_reasoning_efforts).toBeUndefined();
    expect(suggestion.reasoning_effort).toBeUndefined();
  });

  it("suggests a 400K window and the full effort subset for gpt-5 models", () => {
    const suggestion = suggestCapabilities("gpt-5");

    expect(suggestion.supported_context_windows).toEqual([400_000]);
    expect(suggestion.supported_reasoning_efforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(suggestion.reasoning_effort).toBe("medium");
    expect(suggestion.supports_vision).toBe(true);
  });

  it("keeps gpt-4.1 and gpt-4o apart", () => {
    // gpt-4.1's window is representable (1M); gpt-4o's 128K is not, so only its
    // vision fact is claimed.
    expect(suggestCapabilities("gpt-4.1").supported_context_windows).toEqual([
      1_000_000,
    ]);
    expect(
      suggestCapabilities("gpt-4o").supported_context_windows,
    ).toBeUndefined();
    expect(suggestCapabilities("gpt-4o").supports_vision).toBe(true);
  });

  it("claims only thinking for deepseek-reasoner (window has no matching option)", () => {
    const suggestion = suggestCapabilities("deepseek-reasoner");

    expect(suggestion.supports_thinking).toBe(true);
    expect(suggestion.supports_vision).toBe(false);
    expect(suggestion.supported_context_windows).toBeUndefined();
  });

  it("claims no reasoning for a non-reasoning deepseek id", () => {
    const suggestion = suggestCapabilities("deepseek-chat");

    expect(suggestion.supports_thinking).toBe(false);
    expect(suggestion.supports_vision).toBe(false);
    expect(suggestion.supported_reasoning_efforts).toBeUndefined();
  });

  it("matches case-insensitively", () => {
    expect(suggestCapabilities("Claude-Sonnet-4")).toEqual(
      suggestCapabilities("claude-sonnet-4"),
    );
  });

  it("returns an empty suggestion for unknown or empty model ids", () => {
    expect(suggestCapabilities("acme-llm-9000")).toEqual({});
    expect(suggestCapabilities("")).toEqual({});
  });

  it("returns a fresh object so callers cannot poison the table", () => {
    const first = suggestCapabilities("claude-sonnet-4");
    first.supported_context_windows!.push(1_000_000);
    first.supports_vision = false;

    expect(suggestCapabilities("claude-sonnet-4")).toEqual({
      supported_context_windows: [200_000],
      supports_vision: true,
      supports_thinking: true,
    });
  });
});

describe("expandBatchToEntries capability subsets", () => {
  it("carries the shared subset and default to every entry", () => {
    const entries = expandBatchToEntries(
      {
        provider: "openai-compatible",
        apiKey: "k",
        supportedWindows: [200_000, 400_000],
        defaultWindow: 400_000,
        supportedEfforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      ["a", "b"],
      [],
    );

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.supported_context_windows).toEqual([200_000, 400_000]);
      expect(entry.context_window).toBe(400_000);
      expect(entry.supported_reasoning_efforts).toEqual([
        "low",
        "medium",
        "high",
      ]);
      expect(entry.reasoning_effort).toBe("medium");
    }
  });

  it("drops a default window that is not in the selected subset", () => {
    const [entry] = expandBatchToEntries(
      {
        provider: "deepseek",
        apiKey: "k",
        supportedWindows: [200_000],
        defaultWindow: 400_000,
      },
      ["m"],
      [],
    );

    expect(entry!.supported_context_windows).toEqual([200_000]);
    expect(entry!.context_window).toBeUndefined();
  });

  it("drops a default effort that is not in the selected subset", () => {
    const [entry] = expandBatchToEntries(
      {
        provider: "deepseek",
        apiKey: "k",
        supportedEfforts: ["low", "high"],
        defaultEffort: "medium",
      },
      ["m"],
      [],
    );

    expect(entry!.supported_reasoning_efforts).toEqual(["low", "high"]);
    expect(entry!.reasoning_effort).toBeUndefined();
  });

  it("omits an empty subset instead of sending an empty list", () => {
    const [entry] = expandBatchToEntries(
      {
        provider: "deepseek",
        apiKey: "k",
        supportedWindows: [],
        supportedEfforts: [],
        defaultWindow: 200_000,
        defaultEffort: "medium",
      },
      ["m"],
      [],
    );

    expect(entry!.supported_context_windows).toBeUndefined();
    expect(entry!.supported_reasoning_efforts).toBeUndefined();
    expect(entry!.context_window).toBeUndefined();
    expect(entry!.reasoning_effort).toBeUndefined();
  });

  it("keeps the legacy single context_window when no subset is declared", () => {
    const [entry] = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k", contextWindow: 128_000 },
      ["m"],
      [],
    );

    expect(entry!.context_window).toBe(128_000);
    expect(entry!.supported_context_windows).toBeUndefined();
  });
});

describe("validateModelsConfig", () => {
  afterEach(() => {
    fetchMock.fetch.mockReset();
  });

  it("posts the probe to the validate route and returns the outcome", async () => {
    fetchMock.fetch.mockResolvedValue(
      jsonResponse({ ok: true, model_present: true, detail: "available" }),
    );

    const result = await validateModelsConfig(PROBE);

    expect(result).toEqual({
      ok: true,
      model_present: true,
      detail: "available",
    });
    const [url, init] = fetchMock.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/models/config/validate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(PROBE);
  });

  it("surfaces the server detail through ModelsConfigRequestError", async () => {
    fetchMock.fetch.mockResolvedValue(
      jsonResponse({ detail: "Unknown provider 'acme'." }, 422),
    );

    await expect(validateModelsConfig(PROBE)).rejects.toThrow(
      "Unknown provider 'acme'.",
    );
    await expect(validateModelsConfig(PROBE)).rejects.toBeInstanceOf(
      ModelsConfigRequestError,
    );
  });
});
