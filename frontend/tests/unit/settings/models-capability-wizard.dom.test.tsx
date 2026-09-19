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

/**
 * The window subset is a multi-select dropdown and the default is a single-select — Radix
 * menus open on pointerdown, so these two helpers are the only place that knowledge lives.
 * The dropdown stays open across picks (one decision, not N), the select closes on pick.
 */
function openWindowMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: M.supportedWindows }),
    { button: 0 },
  );
}

/**
 * Close it before touching anything else: Radix's menu is modal, so an open menu marks the
 * rest of the form `aria-hidden` and role queries stop finding it (and an absence assertion
 * would pass for the wrong reason).
 */
function closeWindowMenu() {
  fireEvent.keyDown(document, { key: "Escape" });
}

/**
 * The provider is a Radix *Select*, not a dropdown menu, and it opens on **click** here rather
 * than on pointerdown. Radix gates its own `onPointerDown` on `event.pointerType === "mouse"`,
 * which a happy-dom synthetic event never carries; its `onClick`/`onPointerUp` fallback fires
 * whenever that ref is not `"mouse"`, which is the path available in this environment. The same
 * gate decides item selection. Step 1 owns the select, so it can only be driven before「下一步」.
 */
function openProviderSelect() {
  fireEvent.click(screen.getByRole("combobox", { name: M.provider }));
}

async function pickProvider(label: string) {
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

async function pickWindow(label: string) {
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: label }));
}

function openEffortMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: M.supportedEfforts }),
    { button: 0 },
  );
}

async function pickEffort(label: string) {
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: label }));
}

function effortChecked(label: string): string | null {
  return screen
    .getByRole("menuitemcheckbox", { name: label })
    .getAttribute("aria-checked");
}

/** The default rows are single-selects; unit tests read their *displayed* value. */
function defaultEffortShown(): string {
  return screen.getByLabelText(M.defaultEffort).textContent ?? "";
}

/** The default row is a single-select; unit tests read its *displayed* value, not its portal. */
function defaultWindowShown(): string {
  return screen.getByLabelText(M.defaultWindow).textContent ?? "";
}

/** Reads the windows dropdown's *closed* state: the trigger summarises the subset size. */
function windowsSummary(): string {
  return screen.getByRole("button", { name: M.supportedWindows }).textContent ?? "";
}

function windowChecked(label: string): string | null {
  return screen
    .getByRole("menuitemcheckbox", { name: label })
    .getAttribute("aria-checked");
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
    expect(screen.getByLabelText(M.endpoint)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: M.supportedWindows }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() => expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined());
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
    expect(
      screen.getByRole("button", { name: M.supportedWindows }),
    ).toBeDefined();
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
    expect(
      screen.queryByRole("button", { name: M.supportedWindows }),
    ).toBeNull();
    expect(screen.getByLabelText(M.endpoint)).toBeDefined();
  });

  it("surfaces the probe's endpoint advice on step 2 without blocking", async () => {
    fetchMock.fetch.mockResolvedValue(
      jsonResponse({
        ok: true,
        model_present: true,
        detail: "Model 'model-a' is available.",
        warning:
          "The endpoint path ends with '/chat/completions' (chat completions). Use the base URL.",
      }),
    );
    renderAddDialog(rs.fn());
    fillIdentity({
      ids: ["model-a"],
      endpoint: "https://ds.example/v1/chat/completions",
    });

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    // Soft: the wizard still advances, the advice rides along.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined(),
    );
    expect(screen.getByText(/Use the base URL/)).toBeDefined();
  });

  it("shows no endpoint advice when the probe reports none", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["model-a"] });

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined(),
    );
    expect(screen.queryByRole("status")).toBeNull();
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
      screen.getByRole("switch", { name: M.thinking }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("switch", { name: M.vision }).getAttribute("aria-checked"),
    ).toBe("true");
    // Anthropic takes a thinking budget, not effort levels: nothing to pre-check.
    openEffortMenu();
    await screen.findByRole("menuitemcheckbox", {
      name: EFFORT.reasoningEffortLow,
    });
    expect(effortChecked(EFFORT.reasoningEffortLow)).toBe("false");
    closeWindowMenu();
    // The curated window subset lands pre-checked in its dropdown.
    openWindowMenu();
    await screen.findByRole("menuitemcheckbox", { name: M.window200k });
    expect(windowChecked(M.window200k)).toBe("true");
    closeWindowMenu();
    expect(windowsSummary()).toContain(M.subsetSelected(1));
  });

  it("does not prefill or claim a suggestion for an unknown model id", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["acme-llm-9000"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined(),
    );
    expect(screen.queryByText(M.suggested)).toBeNull();
    openWindowMenu();
    await screen.findByRole("menuitemcheckbox", { name: M.window200k });
    expect(windowChecked(M.window200k)).toBe("false");
    closeWindowMenu();
  });

  it("carries the shared window/effort subsets and defaults into every entry", async () => {
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    fillIdentity({ ids: ["model-a", "model-b"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() => expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined());

    openWindowMenu();
    await pickWindow(M.window200k);
    await pickWindow(M.window400k);
    closeWindowMenu();
    // 200K came in alone, so it was adopted as the default; adding 400K does not move a
    // still-valid default (capability.nextDefault) — the select shows where it landed.
    expect(defaultWindowShown()).toContain(M.window200k);
    openEffortMenu();
    await pickEffort(EFFORT.reasoningEffortLow);
    await pickEffort(EFFORT.reasoningEffortMedium);
    closeWindowMenu();
    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    const entries = onAdd.mock.calls[0]?.[0] as ManagedModelInput[];
    expect(entries.map((entry) => entry.name)).toEqual(["model-a", "model-b"]);
    for (const entry of entries) {
      expect(entry.supported_context_windows).toEqual([200_000, 400_000]);
      expect(entry.context_window).toBe(200_000);
      expect(entry.supported_reasoning_efforts).toEqual(["low", "medium"]);
      // "low" came in alone and was adopted; the still-valid default does not follow later picks.
      expect(entry.reasoning_effort).toBe("low");
      expect(entry.supports_reasoning_effort).toBe(true);
      expect(entry.api_key).toBe("sk-shared");
    }
  });

  it("goes back to step 1 without losing the identity inputs", async () => {
    renderAddDialog(rs.fn());
    fillIdentity({ ids: ["model-a"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() => expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: M.back }));

    expect(screen.getByLabelText(M.endpoint)).toBeDefined();
    expect(screen.getByDisplayValue("model-a")).toBeDefined();
    expect(screen.getByLabelText(M.apiKey)).toHaveProperty("value", "sk-shared");
  });

  // ── The declaration decides whether the effort rows exist (spec 2026-09-19 §2 D3) ──
  // The factory translates a declared level into whatever the protocol calls it, so a provider
  // no longer gates the rows: an entry that declares levels edits them, and one that declares
  // none shows no axis. `o3-mini` is curated WITH an effort subset, so the seed exercises the
  // first half on a provider that used to be refused.

  it("offers the declared effort levels on an anthropic entry, and submits them", async () => {
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    openProviderSelect();
    await pickProvider(M.providerAnthropic);
    fillIdentity({ ids: ["o3-mini"] });

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: M.supportedWindows }),
      ).toBeDefined(),
    );
    // `o3-mini` is curated with an effort subset, so both rows are back: what decides is the
    // entry's own declaration — the factory translates the level for whichever protocol.
    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    const entries = onAdd.mock.calls[0]?.[0] as ManagedModelInput[];
    expect(entries[0]?.supports_reasoning_effort).toBe(true);
    expect(entries[0]?.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("still offers the curated effort suggestion when the entry declares levels", async () => {
    // Control for the case above: the same curated id on the default provider keeps both
    // rows, prefilled — so the rule is the declaration, not the model id and not the provider.
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    fillIdentity({ ids: ["o3-mini"] });

    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: M.supportedWindows }),
      ).toBeDefined(),
    );
    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();
    openEffortMenu();
    await screen.findByRole("menuitemcheckbox", {
      name: EFFORT.reasoningEffortMedium,
    });
    expect(effortChecked(EFFORT.reasoningEffortMedium)).toBe("true");
    closeWindowMenu();

    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    const entries = onAdd.mock.calls[0]?.[0] as ManagedModelInput[];
    expect(entries[0]?.supports_reasoning_effort).toBe(true);
    expect(entries[0]?.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("keeps the effort rows when the provider is switched", async () => {
    // Switching providers changes nothing about the axis: the rows are gated on the
    // declaration, not on the protocol, so the same id edits the same way on either side.
    const onAdd = rs.fn();
    renderAddDialog(onAdd);
    fillIdentity({ ids: ["o3-mini"] });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: M.supportedWindows }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: M.back }));
    openProviderSelect();
    await pickProvider(M.providerAnthropic);
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: M.supportedWindows }),
      ).toBeDefined(),
    );

    // Both rows are still there after the switch …
    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();
    expect(screen.getByLabelText(M.defaultEffort)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    // … and the seeded declaration is submitted as-is.
    const entries = onAdd.mock.calls[0]?.[0] as ManagedModelInput[];
    expect(entries[0]?.supports_reasoning_effort).toBe(true);
    expect(entries[0]?.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("ModelsEditDialog capability editor", () => {
  it("keeps the frozen-identity warning in the title's ⓘ, not on a line of its own", () => {
    renderEditDialog(rs.fn());

    // It described the dialog, not a field, and a line of prose above the first input read as
    // part of the form (2026-09-16).
    expect(screen.queryByText(M.identityHint)).toBeNull();
    expect(screen.getByLabelText(M.identityHint)).toBeTruthy();
    // The ⓘ is the dialog's first tabbable, so the focus scope used to land on it — and Radix
    // opens a focused tooltip trigger, which popped the bubble open unprompted. The caret goes
    // to the first field instead, and nothing is open until someone asks.
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText(M.displayName));
  });

  it("shows legacy data without subsets without erroring", async () => {
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

    // No declared window subset: nothing is checked, and with no subset there is nothing
    // to pick a default from, so that row is absent.
    expect(screen.queryByLabelText(M.defaultWindow)).toBeNull();
    openWindowMenu();
    await screen.findByRole("menuitemcheckbox", { name: M.window200k });
    expect(windowChecked(M.window200k)).toBe("false");
    closeWindowMenu();
    // The legacy flag is shown as the full four-level set.
    openEffortMenu();
    await screen.findByRole("menuitemcheckbox", {
      name: EFFORT.reasoningEffortMinimal,
    });
    for (const label of [
      EFFORT.reasoningEffortMinimal,
      EFFORT.reasoningEffortLow,
      EFFORT.reasoningEffortMedium,
      EFFORT.reasoningEffortHigh,
    ]) {
      expect(effortChecked(label)).toBe("true");
    }
    closeWindowMenu();

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

  it("saves an edited subset and keeps a still-valid default", async () => {
    const onSave = rs.fn();
    renderInI18n(
      <ModelsEditDialog
        open
        onOpenChange={() => undefined}
        model={model({
          // The subject here is the effort axis itself, which an anthropic entry can no
          // longer carry (spec 2026-09-19 §2 D3) — so the fixture has to name a provider
          // that can. The anthropic path has its own case below.
          provider: "openai-compatible",
          supported_context_windows: [200_000],
          context_window: 200_000,
          supported_reasoning_efforts: ["low", "high"],
          reasoning_effort: "high",
        })}
        onSave={onSave}
        isPending={false}
      />,
    );

    openWindowMenu();
    await pickWindow(M.window1m);
    closeWindowMenu();
    // The default (200K) is still inside the new subset, so it stays — moving it is the
    // select's job, and its rule is pinned by models/capability.test.ts.
    expect(defaultWindowShown()).toContain(M.window200k);
    openEffortMenu();
    await pickEffort(EFFORT.reasoningEffortMedium);
    closeWindowMenu();
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    const input = onSave.mock.calls[0]?.[0] as ManagedModelInput;
    expect(input.supported_context_windows).toEqual([200_000, 1_000_000]);
    expect(input.context_window).toBe(200_000);
    expect(input.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
    // The seeded effort default ("high") is still in the subset, so it stays.
    expect(input.reasoning_effort).toBe("high");
    expect(defaultEffortShown()).toContain(EFFORT.reasoningEffortHigh);
    // Identity stays frozen.
    expect(input.name).toBe("claude-sonnet-4");
    expect(input.model).toBe("claude-sonnet-4-20250514");
  });

  it("labels the capability block without the add wizard's step number", () => {
    renderEditDialog(rs.fn(), {
      supported_context_windows: [200_000],
      context_window: 200_000,
    });

    // It has no step 1, so reusing the wizard's step-2 title leaked a stray "2." here.
    expect(screen.getByText(M.capabilities)).toBeDefined();
    expect(screen.queryByText("2. 能力配置")).toBeNull();
    expect(screen.getByText(M.supportedWindows)).toBeDefined();
    expect(screen.getByText(M.defaultWindow)).toBeDefined();
    // The windows dropdown summarises its subset instead of listing every option.
    expect(windowsSummary()).toContain(M.subsetSelected(1));
  });

  it("keeps a stored anthropic entry's effort levels on an untouched save", async () => {
    // The declaration is the only thing that gates these rows, so an anthropic entry that
    // declares levels edits them like any other, and saving it unchanged carries exactly what
    // was declared — nothing is cleared on the way out.
    const onSave = rs.fn();
    renderEditDialog(onSave, {
      provider: "anthropic",
      supports_reasoning_effort: true,
      supported_reasoning_efforts: ["low", "medium", "high"],
      reasoning_effort: "medium",
    });

    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();
    expect(screen.getByLabelText(M.defaultEffort)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    const input = onSave.mock.calls[0]?.[0] as ManagedModelInput;
    expect(input.supports_reasoning_effort).toBe(true);
    expect(input.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(input.reasoning_effort).toBe("medium");
    // The window axis is untouched by this rule.
    expect(input.name).toBe("claude-sonnet-4");
  });

  it("keeps the axis declarable on an entry that declares no levels", () => {
    // An empty declaration hides the *default* row — there is nothing to pick a default from —
    // but never the subset row: that dropdown is the only way to declare levels at all, so
    // hiding it would leave an uncurated model permanently undeclarable.
    renderEditDialog(rs.fn(), { provider: "anthropic" });

    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();
    expect(screen.queryByLabelText(M.defaultEffort)).toBeNull();
  });

  it("keeps the effort rows for a provider that can send them", () => {
    // Control: the same dialog, one provider over, still edits the axis.
    renderEditDialog(rs.fn(), {
      provider: "openai-compatible",
      supports_reasoning_effort: true,
      supported_reasoning_efforts: ["low", "high"],
      reasoning_effort: "high",
    });

    expect(
      screen.getByRole("button", { name: M.supportedEfforts }),
    ).toBeDefined();
    expect(screen.getByLabelText(M.defaultEffort)).toBeDefined();
  });
});

function renderEditDialog(onSave: (input: ManagedModelInput) => void, over: Partial<ManagedModel> = {}) {
  return renderInI18n(
    <ModelsEditDialog
      open
      onOpenChange={() => undefined}
      model={model(over)}
      onSave={onSave}
      isPending={false}
    />,
  );
}

/** The attributes that keep Chromium / 1Password / LastPass out of a non-credential field. */
function expectAutofillDefenses(endpoint: HTMLElement, apiKey: HTMLElement) {
  expect(endpoint.getAttribute("type")).toBe("url");
  expect(endpoint.getAttribute("autocomplete")).toBe("off");
  expect(endpoint.getAttribute("data-1p-ignore")).toBe("true");
  expect(endpoint.getAttribute("data-lpignore")).toBe("true");
  expect(endpoint.getAttribute("data-bwignore")).toBe("true");
  expect(endpoint.getAttribute("data-form-type")).toBe("other");
  expect(endpoint.getAttribute("spellcheck")).toBe("false");

  expect(apiKey.getAttribute("type")).toBe("password");
  // "new-password" is what Chromium honours instead of offering the saved login.
  expect(apiKey.getAttribute("autocomplete")).toBe("new-password");
  expect(apiKey.getAttribute("data-1p-ignore")).toBe("true");
  expect(apiKey.getAttribute("data-lpignore")).toBe("true");
  expect(apiKey.getAttribute("data-bwignore")).toBe("true");
}

describe("model dialogs: password-manager autofill", () => {
  it("keeps autofill out of the add dialog's endpoint and API key", () => {
    renderAddDialog(rs.fn());

    expectAutofillDefenses(
      screen.getByLabelText(M.endpoint),
      screen.getByLabelText(M.apiKey),
    );
  });

  it("keeps autofill out of the edit dialog's endpoint and API key", () => {
    renderEditDialog(rs.fn());

    expectAutofillDefenses(
      screen.getByLabelText(M.endpoint),
      screen.getByLabelText(M.apiKey),
    );
  });
});

describe("model dialogs: scrolling long forms", () => {
  it("puts the add dialog body in a scroll container and the actions outside it", () => {
    renderAddDialog(rs.fn());

    const scrollArea = document.querySelector('[data-slot="scroll-area"]');
    const footer = document.querySelector('[data-slot="dialog-footer"]');
    expect(scrollArea).not.toBeNull();
    expect(footer).not.toBeNull();
    // Actions stay reachable while the fields scroll.
    expect(scrollArea?.contains(footer)).toBe(false);
    expect(scrollArea?.contains(screen.getByLabelText(M.endpoint))).toBe(true);
  });

  it("scrolls the edit dialog's capability editor, not its actions", () => {
    renderEditDialog(rs.fn());

    const scrollArea = document.querySelector('[data-slot="scroll-area"]')!;
    expect(
      scrollArea.contains(screen.getByRole("button", { name: M.supportedWindows })),
    ).toBe(true);
    expect(
      scrollArea.contains(document.querySelector('[data-slot="dialog-footer"]')),
    ).toBe(false);
  });
});
