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
import {
  capabilityValueFromModel,
  capabilityValueFromSuggestion,
  capabilityValueToShared,
  emptyCapabilityValue,
  toggleEffort,
  toggleWindow,
} from "@/core/models/capability";
import { suggestCapabilities } from "@/core/models/capability-registry";
import type { ManagedModel } from "@/core/models/types";

function managedModel(over: Partial<ManagedModel> = {}): ManagedModel {
  return {
    name: "m",
    model: "m",
    api_key: "********",
    source: "ui",
    editable: true,
    ...over,
  };
}

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

  it("treats an empty selection as undeclared and drops the empty lists", () => {
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
    // No subset declared: the single defaults stand, exactly like a legacy row.
    expect(entry!.context_window).toBe(200_000);
    expect(entry!.reasoning_effort).toBe("medium");
  });

  it("keeps a single default window with no declared subset", () => {
    const [entry] = expandBatchToEntries(
      { provider: "deepseek", apiKey: "k", defaultWindow: 128_000 },
      ["m"],
      [],
    );

    expect(entry!.context_window).toBe(128_000);
    expect(entry!.supported_context_windows).toBeUndefined();
  });
});

describe("capability value editing", () => {
  it("adds a window in ascending order and auto-picks a lone option as default", () => {
    const first = toggleWindow(emptyCapabilityValue(), 400_000);
    expect(first.supportedWindows).toEqual([400_000]);
    expect(first.defaultWindow).toBe(400_000);

    const second = toggleWindow(first, 200_000);
    expect(second.supportedWindows).toEqual([200_000, 400_000]);
    // The previous default is still a member, so it is kept.
    expect(second.defaultWindow).toBe(400_000);
  });

  it("clears a default window that the selection no longer contains", () => {
    let value = toggleWindow(emptyCapabilityValue(), 200_000);
    value = toggleWindow(value, 400_000);
    value = toggleWindow(value, 1_000_000);
    expect(value.defaultWindow).toBe(200_000);

    value = toggleWindow(value, 200_000);
    expect(value.supportedWindows).toEqual([400_000, 1_000_000]);
    expect(value.defaultWindow).toBeUndefined();
  });

  it("clears the selection and the default when the last window is removed", () => {
    const off = toggleWindow(
      toggleWindow(emptyCapabilityValue(), 200_000),
      200_000,
    );
    expect(off.supportedWindows).toEqual([]);
    expect(off.defaultWindow).toBeUndefined();
  });

  it("adds efforts in enum order with the same default rule", () => {
    let value = toggleEffort(emptyCapabilityValue(), "medium");
    expect(value.supportedEfforts).toEqual(["medium"]);
    expect(value.defaultEffort).toBe("medium");

    value = toggleEffort(value, "minimal");
    expect(value.supportedEfforts).toEqual(["minimal", "medium"]);
    expect(value.defaultEffort).toBe("medium");

    value = toggleEffort(value, "minimal");
    expect(value.supportedEfforts).toEqual(["medium"]);
    expect(value.defaultEffort).toBe("medium");
  });
});

describe("capabilityValueFromModel", () => {
  it("keeps a legacy single window as an undeclared default", () => {
    const value = capabilityValueFromModel(
      managedModel({ context_window: 128_000 }),
    );

    expect(value.supportedWindows).toEqual([]);
    expect(value.defaultWindow).toBe(128_000);
  });

  it("pre-checks every level when only the legacy effort flag is set", () => {
    const value = capabilityValueFromModel(
      managedModel({ supports_reasoning_effort: true }),
    );

    expect(value.supportedEfforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it("reads a declared subset back as stored", () => {
    const value = capabilityValueFromModel(
      managedModel({
        supported_context_windows: [200_000, 400_000],
        context_window: 400_000,
        supported_reasoning_efforts: ["low", "high"],
        reasoning_effort: "high",
        supports_thinking: true,
      }),
    );

    expect(value).toMatchObject({
      supportedWindows: [200_000, 400_000],
      defaultWindow: 400_000,
      supportedEfforts: ["low", "high"],
      defaultEffort: "high",
      supportsThinking: true,
      supportsVision: false,
    });
  });

  it("declares no effort levels without a subset or the flag", () => {
    expect(capabilityValueFromModel(managedModel()).supportedEfforts).toEqual(
      [],
    );
  });
});

describe("capabilityValueFromSuggestion", () => {
  it("seeds a lone suggested window as the default", () => {
    const value = capabilityValueFromSuggestion(
      suggestCapabilities("claude-sonnet-4"),
    );

    expect(value).toMatchObject({
      supportedWindows: [200_000],
      defaultWindow: 200_000,
      supportsThinking: true,
      supportsVision: true,
      supportedEfforts: [],
    });
  });

  it("seeds a multi-level effort subset with its suggested default", () => {
    const value = capabilityValueFromSuggestion(suggestCapabilities("gpt-5"));

    expect(value.supportedEfforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(value.defaultEffort).toBe("medium");
    expect(value.defaultWindow).toBe(400_000);
  });

  it("yields an empty value for an unknown model id", () => {
    expect(
      capabilityValueFromSuggestion(suggestCapabilities("acme-llm-9000")),
    ).toEqual(emptyCapabilityValue());
  });
});

describe("capabilityValueToShared", () => {
  it("derives the effort flag from the declared subset", () => {
    expect(capabilityValueToShared(emptyCapabilityValue())).toMatchObject({
      supportsReasoningEffort: false,
      supportedEfforts: undefined,
    });

    expect(
      capabilityValueToShared({
        ...emptyCapabilityValue(),
        supportedEfforts: ["low"],
        defaultEffort: "low",
      }),
    ).toMatchObject({
      supportsReasoningEffort: true,
      supportedEfforts: ["low"],
      defaultEffort: "low",
    });
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
