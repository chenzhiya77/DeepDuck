/**
 * 两步添加向导 + 能力编辑器（spec 2026-09-10 §5.3.2/§5.4，plan Task 4 seam C dom）：
 * - step1 身份+凭证+Model ID →「下一步」**逐 id** 调 validate → 通过才进 step2；
 * - 校验失败停在 step1 并显示服务端 detail（不落能力编辑）；
 * - curated 表按第一个 Model ID 预填并标注「建议值，可修改」；未知 id 不预填；
 * - 批量两 id → 共享窗口/强度子集与默认套用到每一条；
 * - 编辑弹窗：身份冻结、能力可改；旧数据（无子集）按 context_window / 全 4 档呈现且不报错。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { ManagedModel, ManagedModelInput } from "@/core/models/types";

const fetchMock = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchMock.fetch }));

const { ModelsAddDialog } = await import(
  "@/components/workspace/settings/models-add-dialog"
);
const { ModelsEditDialog } = await import(
  "@/components/workspace/settings/models-edit-dialog"
);

const M = zhCN.settings.models;
const EFFORT = zhCN.inputBox;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function probeOk() {
  return jsonResponse({ ok: true, model_present: true, detail: "available" });
}

function renderInI18n(node: React.ReactNode) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      {node}
    </I18nContext.Provider>,
  );
}

function renderAddDialog(onAdd: (entries: ManagedModelInput[]) => void) {
  return renderInI18n(
    <ModelsAddDialog
      open
      onOpenChange={() => undefined}
      existingNames={[]}
      onAdd={onAdd}
      isPending={false}
    />,
  );
}

function model(over: Partial<ManagedModel> = {}): ManagedModel {
  return {
    name: "claude-sonnet-4",
    model: "claude-sonnet-4-20250514",
    display_name: "Claude Sonnet 4",
    provider: "anthropic",
    endpoint_key: "base_url",
    endpoint: "https://api.anthropic.com",
    api_key: "********",
    source: "ui",
    editable: true,
    ...over,
  };
}

function fillIdentity(values: { endpoint?: string; apiKey?: string; ids: string[] }) {
  fireEvent.change(screen.getByLabelText(M.endpoint), {
    target: { value: values.endpoint ?? "https://ds.example" },
  });
  fireEvent.change(screen.getByLabelText(M.apiKey), {
    target: { value: values.apiKey ?? "sk-shared" },
  });
  values.ids.forEach((id, index) => {
    if (index > 0) {
      fireEvent.click(screen.getByRole("button", { name: M.addModelId }));
    }
    fireEvent.change(screen.getAllByPlaceholderText(M.modelIdPlaceholder)[index]!, {
      target: { value: id },
    });
  });
}

beforeEach(() => {
  fetchMock.fetch.mockReset();
  fetchMock.fetch.mockResolvedValue(probeOk());
});

afterEach(() => {
  cleanup();
});

describe("ModelsAddDialog two-step wizard", () => {
  it("probes every model id before showing the capability editor", async () => {
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    fillIdentity({ ids: ["model-a", "model-b"] });

    // Step 1 owns identity only.
    expect(screen.getByText(M.stepIdentity)).toBeDefined();
    expect(screen.queryByRole("checkbox", { name: M.window200k })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() => expect(screen.getByText(M.stepCapabilities)).toBeDefined());
    expect(fetchMock.fetch).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init.body)),
    );
    expect(bodies.map((body) => body.model)).toEqual(["model-a", "model-b"]);
    expect(bodies[0]).toMatchObject({
      provider: "openai-compatible",
      endpoint: "https://ds.example",
      api_key: "sk-shared",
    });
    expect(screen.getByRole("checkbox", { name: M.window200k })).toBeDefined();
  });

  it("stays on step 1 and shows the server detail when a probe fails", async () => {
    fetchMock.fetch.mockResolvedValue(
      jsonResponse({
        ok: true,
        model_present: false,
        detail: "Model 'model-b' was not found on this endpoint.",
      }),
    );
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["model-a", "model-b"] });

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(
        screen.getByText(/Model 'model-b' was not found on this endpoint/),
      ).toBeDefined(),
    );
    expect(screen.queryByRole("checkbox", { name: M.window200k })).toBeNull();
    expect(screen.getByText(M.stepIdentity)).toBeDefined();
  });

  it("requires an endpoint and a key before probing", async () => {
    renderAddDialog(rs.fn());
    fireEvent.change(screen.getByPlaceholderText(M.modelIdPlaceholder), {
      target: { value: "model-a" },
    });

    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() =>
      expect(screen.getByText(M.validationEndpointRequired)).toBeDefined(),
    );
    expect(fetchMock.fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(M.endpoint), {
      target: { value: "https://ds.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() =>
      expect(screen.getByText(M.validationApiKeyRequired)).toBeDefined(),
    );
    expect(fetchMock.fetch).not.toHaveBeenCalled();
  });

  it("prefills the editor from the curated registry and labels it as a suggestion", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["claude-sonnet-4-20250514"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() => expect(screen.getByText(M.suggested)).toBeDefined());
    expect(
      screen.getByRole("checkbox", { name: M.window200k }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("switch", { name: M.thinking }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("switch", { name: M.vision }).getAttribute("aria-checked"),
    ).toBe("true");
    // Anthropic takes a thinking budget, not effort levels: nothing to pre-check.
    expect(
      screen
        .getByRole("checkbox", { name: EFFORT.reasoningEffortLow })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("does not prefill or claim a suggestion for an unknown model id", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["acme-llm-9000"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(screen.getByText(M.stepCapabilities)).toBeDefined(),
    );
    expect(screen.queryByText(M.suggested)).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: M.window200k }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("carries the shared window/effort subsets and defaults into every entry", async () => {
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    fillIdentity({ ids: ["model-a", "model-b"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() => expect(screen.getByText(M.stepCapabilities)).toBeDefined());

    fireEvent.click(screen.getByRole("checkbox", { name: M.window200k }));
    fireEvent.click(screen.getByRole("checkbox", { name: M.window400k }));
    fireEvent.click(screen.getByRole("radio", { name: M.window400k }));
    fireEvent.click(screen.getByRole("checkbox", { name: EFFORT.reasoningEffortLow }));
    fireEvent.click(screen.getByRole("checkbox", { name: EFFORT.reasoningEffortMedium }));
    fireEvent.click(screen.getByRole("radio", { name: EFFORT.reasoningEffortMedium }));

    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    const entries = onAdd.mock.calls[0]?.[0] as ManagedModelInput[];
    expect(entries.map((entry) => entry.name)).toEqual(["model-a", "model-b"]);
    for (const entry of entries) {
      expect(entry.supported_context_windows).toEqual([200_000, 400_000]);
      expect(entry.context_window).toBe(400_000);
      expect(entry.supported_reasoning_efforts).toEqual(["low", "medium"]);
      expect(entry.reasoning_effort).toBe("medium");
      expect(entry.supports_reasoning_effort).toBe(true);
      expect(entry.api_key).toBe("sk-shared");
    }
  });

  it("goes back to step 1 without losing the identity inputs", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["model-a"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() => expect(screen.getByText(M.stepCapabilities)).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: M.back }));

    expect(screen.getByText(M.stepIdentity)).toBeDefined();
    expect(screen.getByDisplayValue("model-a")).toBeDefined();
    expect(screen.getByLabelText(M.apiKey)).toHaveProperty("value", "sk-shared");
  });
});

describe("ModelsEditDialog capability editor", () => {
  it("shows legacy data without subsets without erroring", () => {
    const onSave = rs.fn();
    renderInI18n(
      <ModelsEditDialog
        open
        onOpenChange={() => undefined}
        model={model({
          provider: "deepseek",
          context_window: 128_000,
          supports_reasoning_effort: true,
        })}
        onSave={onSave}
        isPending={false}
      />,
    );

    // No declared window subset: nothing is checked, the legacy default is kept.
    expect(
      screen.getByRole("checkbox", { name: M.window200k }).getAttribute("aria-checked"),
    ).toBe("false");
    // The legacy flag is shown as the full four-level set.
    for (const label of [
      EFFORT.reasoningEffortMinimal,
      EFFORT.reasoningEffortLow,
      EFFORT.reasoningEffortMedium,
      EFFORT.reasoningEffortHigh,
    ]) {
      expect(
        screen.getByRole("checkbox", { name: label }).getAttribute("aria-checked"),
      ).toBe("true");
    }

    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    const input = onSave.mock.calls[0]?.[0] as ManagedModelInput;
    expect(input.context_window).toBe(128_000);
    expect(input.supported_context_windows).toBeUndefined();
    expect(input.supported_reasoning_efforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(input.supports_reasoning_effort).toBe(true);
    expect(input.reasoning_effort).toBeUndefined();
  });

  it("saves edited subsets and their defaults", () => {
    const onSave = rs.fn();
    renderInI18n(
      <ModelsEditDialog
        open
        onOpenChange={() => undefined}
        model={model({
          supported_context_windows: [200_000],
          context_window: 200_000,
          supported_reasoning_efforts: ["low", "high"],
          reasoning_effort: "high",
        })}
        onSave={onSave}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: M.window1m }));
    fireEvent.click(screen.getByRole("radio", { name: M.window1m }));
    fireEvent.click(screen.getByRole("checkbox", { name: EFFORT.reasoningEffortMedium }));
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    const input = onSave.mock.calls[0]?.[0] as ManagedModelInput;
    expect(input.supported_context_windows).toEqual([200_000, 1_000_000]);
    expect(input.context_window).toBe(1_000_000);
    expect(input.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(input.reasoning_effort).toBe("high");
    // Identity stays frozen.
    expect(input.name).toBe("claude-sonnet-4");
    expect(input.model).toBe("claude-sonnet-4-20250514");
  });
});
