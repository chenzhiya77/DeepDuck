/**
 * 添加弹窗第一步的请求头行（spec 2026-09-21 §3.4 / D4，plan Task 3）：
 * `default_headers` 归连接组 ⇒ 控件在两个弹窗各一份，这里钉**添加腿**
 * （编辑腿在 `models-edit-dialog.dom.test.tsx`）。
 *
 * 钉死：填了「名称/值」⇒ `onAdd` 的 payload 里带 `default_headers`（真接线，不是纯函数）；
 * 一行没填 ⇒ 键**不存在**（不是 `{}` —— 空对象会被后端写进文件）。
 * 直接渲染弹窗：`open` 是受控 prop、mount 零网络，只有「下一步」会探针校验 ⇒ mock 掉 fetcher
 * （先例 = `tests/unit/settings/models-settings-page.dom.test.tsx` 的同一处 mock）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { ManagedModelInput } from "@/core/models/types";

const fetchMock = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchMock.fetch }));

const { ModelsAddDialog } =
  await import("@/components/workspace/settings/models-add-dialog");

const M = zhCN.settings.models;

function renderDialog(onAdd: (entries: ManagedModelInput[]) => void) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <ModelsAddDialog
        open
        onOpenChange={() => undefined}
        existingNames={[]}
        onAdd={onAdd}
        isPending={false}
      />
    </I18nContext.Provider>,
  );
}

/** Fill what the wizard needs to pass step 1, then submit from step 2. */
async function addOneModel() {
  fireEvent.change(screen.getByLabelText(M.apiKey), {
    target: { value: "sk-x" },
  });
  fireEvent.change(screen.getByLabelText(M.endpoint), {
    target: { value: "https://api.example/v1" },
  });
  fireEvent.change(screen.getByPlaceholderText(M.modelIdPlaceholder), {
    target: { value: "model-a" },
  });
  fireEvent.click(screen.getByRole("button", { name: M.next }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: M.supportedWindows }),
    ).toBeDefined(),
  );
  fireEvent.click(screen.getByRole("button", { name: M.addSubmit }));
}

beforeEach(() => {
  fetchMock.fetch.mockReset();
  fetchMock.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, model_present: true, detail: "available" }),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
});

describe("ModelsAddDialog request headers", () => {
  it("carries the typed header rows into the entries on save", async () => {
    const onAdd = rs.fn();
    renderDialog(onAdd);

    fireEvent.click(screen.getByRole("button", { name: M.addHeader }));
    fireEvent.change(screen.getByPlaceholderText(M.headerNamePlaceholder), {
      target: { value: "x-opencode-session" },
    });
    fireEvent.change(screen.getByPlaceholderText(M.headerValuePlaceholder), {
      target: { value: "sess-1" },
    });
    await addOneModel();

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const [entries] = onAdd.mock.calls[0] as [ManagedModelInput[]];
    expect(entries[0]?.default_headers).toEqual({
      "x-opencode-session": "sess-1",
    });
  });

  it("writes no header key when nothing was filled in", async () => {
    const onAdd = rs.fn();
    renderDialog(onAdd);

    await addOneModel();

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const [entries] = onAdd.mock.calls[0] as [ManagedModelInput[]];
    expect("default_headers" in (entries[0] ?? {})).toBe(false);
  });
});

/**
 * 分组（spec 2026-09-22 provider-grouping §3.3 / D1–D3）与随带文案（D6–D11）。
 *
 * 候选列表的配方 = `models-capability-wizard.dom.test.tsx:123-129`（`fireEvent.click` 开、
 * `findByRole("option")` 选）—— happy-dom 下 Radix Select 走 click 这条 fallback 路。
 */
function openProviderSelect() {
  fireEvent.click(screen.getByRole("combobox", { name: M.provider }));
}

async function pickProvider(label: string) {
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("ModelsAddDialog provider dropdown", () => {
  it("groups the ids under two headings, with a separator between them", async () => {
    renderDialog(rs.fn());
    openProviderSelect();

    expect(await screen.findByText(M.providerGroupGeneric)).toBeDefined();
    expect(screen.getByText(M.providerGroupVendor)).toBeDefined();
    expect(
      document.querySelector('[data-slot="select-separator"]'),
    ).not.toBeNull();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      M.providerOpenaiCompatible,
      M.providerAnthropic,
      M.providerDeepseek,
    ]);
  });

  it("moves the trigger with the pick but submits the id, not the label", async () => {
    const onAdd = rs.fn();
    renderDialog(onAdd);

    const trigger = () => screen.getByRole("combobox", { name: M.provider });
    expect(trigger().textContent).toBe(M.providerOpenaiCompatible);

    openProviderSelect();
    await pickProvider(M.providerDeepseek);

    expect(trigger().textContent).toBe(M.providerDeepseek);
    await addOneModel();

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const [entries] = onAdd.mock.calls[0] as [ManagedModelInput[]];
    expect(entries[0]?.provider).toBe("deepseek");
  });
});

describe("ModelsAddDialog copy", () => {
  it("keeps the row label and the three curated provider spellings", () => {
    expect(M.customProvider).toBe("自定义");
    expect(M.providerOpenaiCompatible).toBe("OpenAI-compatible");
    expect(M.providerAnthropic).toBe("Anthropic");
    expect(M.providerDeepseek).toBe("DeepSeek");
    // D7: 那一格 zh 与 en 同值 —— 单边改词会在这里红。
    expect(M.providerOpenaiCompatible).toBe(
      enUS.settings.models.providerOpenaiCompatible,
    );
  });

  it("keeps the two group headings", () => {
    expect(M.providerGroupGeneric).toBe("通用协议");
    expect(M.providerGroupVendor).toBe("厂商");
    expect(enUS.settings.models.providerGroupGeneric).toBe("Generic protocol");
    expect(enUS.settings.models.providerGroupVendor).toBe("Vendors");
  });

  it("asks for the key and the model id with the agreed placeholders", () => {
    renderDialog(rs.fn());

    expect(screen.getByPlaceholderText(M.apiKeyPlaceholder)).toBeDefined();
    expect(screen.getByPlaceholderText(M.modelIdPlaceholder)).toBeDefined();
    expect(M.apiKeyPlaceholder).toBe("请输入API Key");
    expect(M.modelIdPlaceholder).toBe("请输入模型ID名称");
    expect(enUS.settings.models.apiKeyPlaceholder).toBe("Enter API key");
    expect(enUS.settings.models.modelIdPlaceholder).toBe("Enter the model ID");
  });

  it("renders exactly one plus per add button", () => {
    renderDialog(rs.fn());

    for (const name of [M.addHeader, M.addModelId]) {
      const button = screen.getByRole("button", { name });

      expect(button.textContent ?? "").not.toContain("+");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("calls the gateway thinking shape by the path it writes", () => {
    expect(M.thinkingShapeGateway).toBe("extra_body.thinking（OpenAI 兼容）");
    expect(enUS.settings.models.thinkingShapeGateway).toBe(
      "extra_body.thinking (OpenAI-compatible)",
    );
  });

  it("labels the header row fields generically", () => {
    renderDialog(rs.fn());
    fireEvent.click(screen.getByRole("button", { name: M.addHeader }));

    expect(screen.getByPlaceholderText(M.headerNamePlaceholder)).toBeDefined();
    expect(screen.getByPlaceholderText(M.headerValuePlaceholder)).toBeDefined();
    expect(M.headerNamePlaceholder).toBe("Header 名称");
    expect(M.headerValuePlaceholder).toBe("Header 值");
    expect(enUS.settings.models.headerNamePlaceholder).toBe("Header name");
    expect(enUS.settings.models.headerValuePlaceholder).toBe("Header value");
  });
});
