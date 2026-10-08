/**
 * 模型设置页（spec 2026-09-10 §5.7，plan Task 4 seam C；2026-10-08
 * models-list-grouping §2 改版）：
 * - 三态：loading / adminRequired(403) / 空态引导；
 * - 列表：按 provider 分组的合并容器 + 单行行（无副标题、无黑胶囊；config_file
 *   灰胶囊保留、只读行无编辑/删除）；「默认」胶囊恰在合并第一行；
 * - 组内拖动：拖柄只给可拖行（editable && !order_pinned），拖往钉住行方向
 *   no-op，写回 = 分组展平序（纯函数语义在 tests/unit/models/grouping.test.ts）；
 * - 展示开关：`hidden_in_chat` 名单随每次写回整体携带；删除同步剔除悬挂名；
 *   写回失败回滚开关态；默认行开关锁开 + Tooltip 原因（D1）；
 * - 能力字段在外科式整体写中不丢（改 A 保存后 B 的能力仍在）；
 * - 批量添加：一把 key + 两个 Model ID →「下一步」校验通过 →「添加」save 收到两条 entry 各带同 key；
 * - 全空 Model ID 被阻（save 不被调用）；API 类型仅 openai-compatible 显示。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { ModelsConfigRequestError } from "@/core/models/api";
import type {
  ManagedModel,
  ModelsConfigSavePayload,
} from "@/core/models/types";

const fetchMock = rs.hoisted(() => ({ fetch: rs.fn() }));
const hooksMock = rs.hoisted(() => ({
  useModelsConfig: rs.fn(),
  useSaveModelsConfig: rs.fn(),
}));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchMock.fetch }));
rs.mock("@/core/models/hooks", () => hooksMock);
rs.mock("sonner", () => ({
  toast: { success: rs.fn(), error: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

const { ModelsSettingsPage } = await import(
  "@/components/workspace/settings/models-settings-page"
);

const M = zhCN.settings.models;

function uiModel(over: Partial<ManagedModel> = {}): ManagedModel {
  return {
    name: "ui-model",
    model: "deepseek-chat",
    display_name: "UI DeepSeek",
    provider: "deepseek",
    endpoint_key: "api_base",
    endpoint: "https://ui.example",
    api_key: "********",
    source: "ui",
    editable: true,
    ...over,
  };
}

function cfgModel(over: Partial<ManagedModel> = {}): ManagedModel {
  return {
    name: "cfg-model",
    model: "gpt-4",
    display_name: null,
    provider: "openai-compatible",
    endpoint_key: "base_url",
    endpoint: null,
    api_key: "********",
    source: "config_file",
    editable: false,
    ...over,
  };
}

const saveMock = rs.fn();

/** The PUT payload every save path submits (wholesale models + hidden list). */
function savedPayload(call = 0): ModelsConfigSavePayload {
  return (saveMock.mock.calls[call]?.[0] ?? {}) as ModelsConfigSavePayload;
}

function setConfig(models: ManagedModel[], opts: { loading?: boolean; error?: unknown } = {}) {
  hooksMock.useModelsConfig.mockReturnValue({
    config: { models },
    isLoading: opts.loading ?? false,
    error: opts.error ?? null,
  });
  hooksMock.useSaveModelsConfig.mockReturnValue({ mutate: saveMock, isPending: false });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <ModelsSettingsPage />
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  saveMock.mockReset();
  // Saves resolve by default; the rollback pin swaps in a failing implementation.
  saveMock.mockImplementation((_payload: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  });
  fetchMock.fetch.mockReset();
  // Step 1 probes the provider before it unlocks the capability step.
  fetchMock.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, model_present: true, detail: "available" }),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
});

describe("ModelsSettingsPage three states", () => {
  it("shows the loading hint", () => {
    setConfig([], { loading: true });
    renderPage();
    expect(screen.getByText(zhCN.common.loading)).toBeDefined();
  });

  it("shows adminRequired on a 403", () => {
    setConfig([], { error: new ModelsConfigRequestError(403, "forbidden") });
    renderPage();
    expect(screen.getByText(M.adminRequired)).toBeDefined();
  });

  it("shows the empty guide with an add button", () => {
    setConfig([]);
    renderPage();
    expect(screen.getByText(M.empty)).toBeDefined();
    expect(screen.getByRole("button", { name: M.add })).toBeDefined();
  });

  it("keeps the add button on the view-switch row, not on a line of its own", () => {
    setConfig([]);
    renderPage();

    // Same parent = same row: the switch is on the left, its action on the right.
    const toggle = screen.getByRole("group", { name: M.viewSwitchLabel });
    expect(screen.getByRole("button", { name: M.add }).parentElement).toBe(
      toggle.parentElement,
    );
  });

  it("gives the view-switch row a floor of its own, so views do not shift it", () => {
    // D5 甲 (spec 2026-09-22 §3.2): the functional view's header ran taller than this line,
    // so switching views moved everything below it by 4px (measured 34/30). The row owns the
    // floor instead of inheriting whatever height its children happen to have.
    setConfig([]);
    renderPage();

    const toggle = screen.getByRole("group", { name: M.viewSwitchLabel });
    expect(toggle.parentElement?.className).toContain("min-h-9");
  });

  it("lets the view-switch row wrap instead of squeezing its controls", () => {
    // D4 甲 (spec 2026-09-24 §3.3): at extreme narrowness the action moves to a second
    // line rather than crushing the switch — one class, the row keeps its own floor.
    setConfig([]);
    renderPage();

    const toggle = screen.getByRole("group", { name: M.viewSwitchLabel });
    expect(toggle.parentElement?.className).toContain("flex-wrap");
  });

  it("renders the add button small, so the row does not outgrow its floor", () => {
    // D5 乙: the default `h-9` would push the row past `min-h-9` and bring the jump back.
    setConfig([]);
    renderPage();

    expect(screen.getByRole("button", { name: M.add }).className).toContain(
      "h-8",
    );
  });

  it("still hides the add action when the admin cannot manage models", () => {
    setConfig([], { error: new ModelsConfigRequestError(403, "forbidden") });
    renderPage();

    // Moving the button up must not offer a wizard that can only fail on save.
    expect(screen.getByText(M.adminRequired)).toBeDefined();
    expect(screen.queryByRole("button", { name: M.add })).toBeNull();
  });

  it("moves the section's prose into the title's ⓘ, both views' sentences together", () => {
    setConfig([]);
    renderPage();

    const F = zhCN.settings.functionalModels;
    // Neither sentence is a line on the page any more (2026-09-16)…
    expect(screen.queryByText(M.description)).toBeNull();
    expect(screen.queryByText(F.description)).toBeNull();
    // …they are one accessible name on the title: the functional view configures this section
    // too, so its sentence belongs here rather than under the view switch.
    expect(
      screen.getByLabelText(`${M.description} ${F.description}`),
    ).toBeDefined();
  });
});

describe("ModelsSettingsPage list", () => {
  it("drops both source capsules: the row tail's buttons are the state", () => {
    setConfig([uiModel(), cfgModel()]);
    renderPage();

    // 黑胶囊退役（2026-10-08 裁决③）：可编辑由行尾按钮自证，不再打来源章。
    expect(screen.queryByText("UI·可编辑")).toBeNull();
    // 灰胶囊同判（spec §7①，覆盖旧留用裁定）：它在替按钮说话，不是独立状态；
    // 来源只决定能否编辑，按钮有无已经说明。键已删，断言按字面守门。
    expect(screen.queryByText("配置文件·只读")).toBeNull();
    // 列表行标签=name（spec §8③）：display_name 里的「DashScope /」等提供商前缀
    // 在分组视图里冗余，组标签已经说了提供商；对话下拉仍用 display_name。
    expect(screen.getByText("ui-model")).toBeDefined();
    expect(screen.queryByText("UI DeepSeek")).toBeNull();
    expect(screen.getByText("cfg-model")).toBeDefined();

    expect(screen.getAllByRole("button", { name: M.delete })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: M.edit })).toHaveLength(1);
  });

  it("orders the row tail as edit, delete, then the switch — switch rightmost", () => {
    // spec §7②：滑块恒贴右缘成一列（图 3 先例），编辑/删除在它前面。
    setConfig([uiModel(), cfgModel()]);
    renderPage();

    const uiRow = document.querySelector(
      "[data-testid='model-row'][data-model-name='ui-model']",
    );
    const tail = [...uiRow!.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.getAttribute("role"),
    );
    expect(tail).toEqual([M.edit, M.delete, M.showInChat]);

    const cfgRow = document.querySelector(
      "[data-testid='model-row'][data-model-name='cfg-model']",
    );
    const cfgTail = [...cfgRow!.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.getAttribute("role"),
    );
    expect(cfgTail).toEqual([M.showInChat]);
  });

  it("keeps the group label outside the container in a fused folder tab", () => {
    // spec §7③：组名移出容器，夹层标签骑在容器顶边（-mb-px 融边）、淡色、等宽（数值真栈量）。
    setConfig([uiModel(), cfgModel()]);
    renderPage();

    const tabs = [...document.querySelectorAll("[data-testid='model-group-tab']")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      // 不在容器里
      expect(tab.closest("[data-testid='model-group']")).toBeNull();
      for (const token of ["rounded-t-md", "bg-muted/70", "-mb-[11px]", "border-b-0"]) {
        expect(tab.className).toContain(token);
      }
    }
    // 首现序：uiModel(deepseek) 在前、cfgModel(openai-compatible) 在后。
    expect(tabs[0]!.textContent).toBe(M.providerDeepseek);
    expect(tabs[1]!.textContent).toBe(M.providerOpenaiCompatible);
  });

  it("gives every row the same floor and keeps the tail buttons small and dim", () => {
    // spec §8②：按钮不再撑高行（统一 min-h-12），编辑/删除缩到 h-7 并压暗。
    setConfig([uiModel(), cfgModel()]);
    renderPage();

    for (const row of document.querySelectorAll("[data-testid='model-row']")) {
      expect(row.className).toContain("min-h-12");
    }
    const edit = screen.getByRole("button", { name: M.edit });
    expect(edit.className).toContain("h-7");
    expect(edit.className).toContain("text-muted-foreground/60");
    const del = screen.getByRole("button", { name: M.delete });
    expect(del.className).toContain("h-7");
    expect(del.className).toContain("text-muted-foreground/60");
  });

  it("groups rows into one filled container per provider", () => {
    setConfig([uiModel(), cfgModel()]);
    renderPage();

    // 2026-09-16 的灰块修复换了载体：行不再各自成卡（`gap-4` 一叠卡片），
    // 每组一个 `bg-card` 合并容器，组头 = providerLabel，行单行于容器内。
    const groups = document.querySelectorAll("[data-testid='model-group']");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.className).toContain("bg-card");
    }
    expect(screen.getByText(M.providerDeepseek)).toBeDefined();
    expect(screen.getByText(M.providerOpenaiCompatible)).toBeDefined();
  });
});

describe("ModelsSettingsPage capability round trip", () => {
  it("preserves another model's capability fields when saving an edit", async () => {
    setConfig([
      uiModel({
        name: "with-caps",
        supported_context_windows: [200_000, 400_000],
        context_window: 400_000,
        supported_reasoning_efforts: ["low", "medium"],
        reasoning_effort: "medium",
      }),
      uiModel({ name: "no-caps" }),
    ]);
    renderPage();

    // Open the second row's editor and save it untouched: the collection is
    // written wholesale, so the first row's capabilities must survive.
    fireEvent.click(screen.getAllByRole("button", { name: M.edit })[1]!);
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const payload = savedPayload();
    expect(payload.models.map((model) => model.name)).toEqual([
      "with-caps",
      "no-caps",
    ]);
    // hidden_in_chat rides on every save (wholesale write: a dropped key clears).
    expect(payload.hidden_in_chat).toEqual([]);
    expect(payload.models[0]).toMatchObject({
      supported_context_windows: [200_000, 400_000],
      context_window: 400_000,
      supported_reasoning_efforts: ["low", "medium"],
      reasoning_effort: "medium",
    });
  });

  it("keeps an untouched anthropic row's effort levels on the same save", async () => {
    // The collection is written wholesale, so an anthropic row the admin never opened is on
    // the wire too. Its declaration is carried through as-is: the level is translated for that
    // protocol at build time, so nothing here needs to strip it.
    setConfig([
      uiModel({
        name: "declared-anthropic",
        provider: "anthropic",
        supports_reasoning_effort: true,
        supported_reasoning_efforts: ["low", "medium", "high"],
        reasoning_effort: "medium",
      }),
      uiModel({ name: "plain" }),
    ]);
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: M.edit })[1]!);
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const payload = savedPayload();
    expect(payload.models.map((model) => model.name)).toEqual([
      "declared-anthropic",
      "plain",
    ]);
    expect(payload.models[0]?.supports_reasoning_effort).toBe(true);
    expect(payload.models[0]?.supported_reasoning_efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(payload.models[0]?.reasoning_effort).toBe("medium");
  });

  it("keeps the five field-parity fields on a row nobody touched", async () => {
    // `toManagedInput` is the projector every *other* row travels through (spec 2026-09-21
    // D6): `default_headers` / the thinking recipes are new, `max_tokens` and
    // `use_responses_api` were already being dropped here. Delete-driven on purpose — the
    // row that must survive is never opened, so no dialog is involved.
    setConfig([
      uiModel({
        name: "with-parity",
        default_headers: { "x-opencode-session": "sess-1" },
        when_thinking_enabled: { extra_body: { thinking: { type: "enabled" } } },
        when_thinking_disabled: {
          extra_body: { thinking: { type: "disabled" } },
        },
        max_tokens: 8192,
        use_responses_api: true,
      }),
      uiModel({ name: "victim" }),
    ]);
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: M.delete })[1]!);

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const payload = savedPayload();
    expect(payload.models.map((model) => model.name)).toEqual(["with-parity"]);
    expect(payload.models[0]).toMatchObject({
      default_headers: { "x-opencode-session": "sess-1" },
      when_thinking_enabled: { extra_body: { thinking: { type: "enabled" } } },
      when_thinking_disabled: {
        extra_body: { thinking: { type: "disabled" } },
      },
      max_tokens: 8192,
      use_responses_api: true,
    });
  });
});

describe("ModelsSettingsPage batch add", () => {
  it("expands one key + two model ids into two entries on save", async () => {
    setConfig([]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: M.add }));

    fireEvent.change(screen.getByLabelText(M.apiKey), { target: { value: "sk-shared" } });
    fireEvent.change(screen.getByPlaceholderText(M.modelIdPlaceholder), {
      target: { value: "model-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: M.addModelId }));
    const ids = screen.getAllByPlaceholderText(M.modelIdPlaceholder);
    fireEvent.change(ids[1]!, { target: { value: "model-b" } });

    fireEvent.change(screen.getByLabelText(M.endpoint), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: M.next }));
    await waitFor(() => expect(screen.getByRole("button", { name: M.supportedWindows })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const payload = savedPayload();
    expect(payload.models).toHaveLength(2);
    expect(payload.models[0]).toMatchObject({ name: "model-a", api_key: "sk-shared", provider: "openai-compatible" });
    expect(payload.models[1]).toMatchObject({ name: "model-b", api_key: "sk-shared" });
  });

  it("blocks submit when every model id is empty", async () => {
    setConfig([]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: M.add }));
    fireEvent.change(screen.getByLabelText(M.apiKey), { target: { value: "sk-x" } });
    fireEvent.click(screen.getByRole("button", { name: M.next }));

    await waitFor(() => expect(screen.getByText(M.validationNoModelId)).toBeDefined());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("shows the API type selector for the default openai-compatible provider", () => {
    setConfig([]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: M.add }));
    // Default provider is openai-compatible → API type is offered. The
    // "only openai-compatible" rule (hidden for anthropic/deepseek) is pinned
    // at the node level in batch.test.ts (use_responses_api gating); we avoid
    // driving the Radix Select here because its open/close is unreliable under
    // happy-dom.
    expect(screen.getByText(M.apiType)).toBeDefined();
  });
});

describe("ModelsSettingsPage grouped drag and display toggle", () => {
  // 2026-10-08 models-list-grouping §2③④：拖柄条件、组内拖动写回序、clamp、
  // 展示开关的整表携带/回滚/悬挂名剔除、「默认」胶囊与锁开开关。
  function dragFixtures(): ManagedModel[] {
    return [
      cfgModel({ name: "cfg", display_name: "Cfg", order_pinned: true }),
      uiModel({
        name: "ovr",
        display_name: "Ovr",
        provider: "openai-compatible",
        order_pinned: true,
      }),
      uiModel({
        name: "alpha",
        display_name: "Alpha",
        provider: "openai-compatible",
      }),
      uiModel({
        name: "beta",
        display_name: "Beta",
        provider: "openai-compatible",
        hidden_in_chat: true,
      }),
      uiModel({ name: "gama", display_name: "Gama", provider: "deepseek" }),
    ];
  }

  function rowEl(name: string): HTMLElement {
    const el = document.querySelector(`[data-model-name="${name}"]`);
    if (!el) throw new Error(`row ${name} not rendered`);
    return el as HTMLElement;
  }

  function rowOrder(): Array<string | null> {
    return Array.from(document.querySelectorAll("[data-model-name]")).map(
      (el) => el.getAttribute("data-model-name"),
    );
  }

  function switchIn(name: string): HTMLElement {
    return within(rowEl(name)).getByRole("switch");
  }

  it("keeps rows single-line and marks only the merged-first row as default", () => {
    setConfig(dragFixtures());
    renderPage();

    // 副标题（提供商 · 模型 ID）死了：模型 ID 不再出现在行内。
    expect(rowEl("alpha").textContent).not.toContain("deepseek-chat");
    const badges = screen.getAllByText(M.defaultBadge);
    expect(badges).toHaveLength(1);
    expect(within(rowEl("cfg")).getByText(M.defaultBadge)).toBeDefined();
  });

  it("offers a drag handle only on movable rows (editable && !order_pinned)", () => {
    setConfig(dragFixtures());
    renderPage();

    expect(within(rowEl("cfg")).queryByTestId("drag-handle")).toBeNull();
    expect(within(rowEl("ovr")).queryByTestId("drag-handle")).toBeNull();
    expect(rowEl("cfg").getAttribute("draggable")).toBeNull();
    expect(rowEl("ovr").getAttribute("draggable")).toBeNull();
    expect(within(rowEl("alpha")).getByTestId("drag-handle")).toBeDefined();
    expect(rowEl("alpha").getAttribute("draggable")).toBe("true");
  });

  it("reorders movable rows in-group and writes back the grouped flatten order", () => {
    setConfig(dragFixtures());
    renderPage();

    fireEvent.dragStart(rowEl("alpha"));
    fireEvent.dragOver(rowEl("beta"));
    expect(rowOrder()).toEqual(["cfg", "ovr", "beta", "alpha", "gama"]);
    fireEvent.dragEnd(rowEl("alpha"));

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(savedPayload(0).models.map((model) => model.name)).toEqual([
      "ovr",
      "beta",
      "alpha",
      "gama",
    ]);
  });

  it("clamps at pinned rows: crossing toward them is a no-op", () => {
    setConfig(dragFixtures());
    renderPage();

    fireEvent.dragStart(rowEl("alpha"));
    fireEvent.dragOver(rowEl("ovr"));
    fireEvent.dragEnd(rowEl("alpha"));

    // 无位移、无写回（★2）。
    expect(rowOrder()).toEqual(["cfg", "ovr", "alpha", "beta", "gama"]);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("toggles the display switch and writes the hidden list wholesale", () => {
    setConfig(dragFixtures());
    renderPage();

    expect(switchIn("beta").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(switchIn("beta"));
    expect(savedPayload(0).hidden_in_chat).toEqual([]);

    fireEvent.click(switchIn("alpha"));
    expect(savedPayload(1).hidden_in_chat).toEqual(["alpha"]);
  });

  it("rolls the switch back when the save fails", () => {
    setConfig(dragFixtures());
    saveMock.mockImplementation(
      (_payload: unknown, opts?: { onError?: (error: Error) => void }) => {
        opts?.onError?.(new Error("save failed"));
      },
    );
    renderPage();

    fireEvent.click(switchIn("alpha"));

    expect(saveMock).toHaveBeenCalledTimes(1);
    // 全量携带：初始隐藏的 beta 也在名单里（写回是整表，不是增量）。
    expect(savedPayload(0).hidden_in_chat).toEqual(["beta", "alpha"]);
    expect(switchIn("alpha").getAttribute("aria-checked")).toBe("true");
  });

  it("drops the deleted name from hidden_in_chat (no dangling names)", () => {
    setConfig(dragFixtures());
    renderPage();

    fireEvent.click(
      within(rowEl("beta")).getByRole("button", { name: M.delete }),
    );

    expect(savedPayload(0).models.map((model) => model.name)).toEqual([
      "ovr",
      "alpha",
      "gama",
    ]);
    expect(savedPayload(0).hidden_in_chat).toEqual([]);
  });

  it("locks the default row's switch on, with the reason in a tooltip", async () => {
    setConfig(dragFixtures());
    renderPage();

    const switchEl = switchIn("cfg");
    expect(switchEl.hasAttribute("disabled")).toBe(true);
    fireEvent.focus(switchEl);

    // Scoped to the tooltip bubble: the same sentence also rides on other nodes
    // inside Radix's tooltip subtree, so a bare getByText finds duplicates.
    await waitFor(() => {
      const bubbles = Array.from(
        document.querySelectorAll("[data-slot='tooltip-content']"),
      );
      expect(
        bubbles.some((bubble) =>
          (bubble.textContent ?? "").includes(M.defaultToggleLockReason),
        ),
      ).toBe(true);
    });
  });
});
