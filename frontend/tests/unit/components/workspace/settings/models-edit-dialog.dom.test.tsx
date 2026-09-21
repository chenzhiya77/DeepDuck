/**
 * 编辑弹窗的连接组回填与写回（spec 2026-09-21 §3.4 / D6，plan Task 3）：
 * 三个字段（`default_headers` / `max_tokens` / `use_responses_api`）必须**读得回来** ——
 * 整集合 PUT 会把读不到的字段抹掉，所以打开时预填 + 保存时带回是同一条防线。
 *
 * 钉死：① 已存的请求头/`max_tokens` 打开即显示（今天恒空）；② 改过的头进 payload；
 * ③ 「API 类型」按 `use_responses_api === true` 显示 Responses、保存原样带回；
 * ④ 防呆：从没设过该键的条目**不许凭空多出** `use_responses_api`（更不许是 `false`）；
 * ⑤ 取证钉子（首跑即绿）：只改显示名也让 anthropic 条目带上形状③的配方 —— Task 2 的接线，
 *    这里只是防止将来被当成 bug 拆掉（plan Task 3 RED 第 ④ 条，2026-09-22 改判）。
 *
 * 直接渲染弹窗（`open` 是受控 prop、mount 零网络）。⚠️ 不开 Radix `Select` 的候选列表 ——
 * 仓内先例（`models-settings-page.dom.test.tsx`）写着 happy-dom 下它的开合不可靠；
 * 「Chat ⇒ 不写键」的规则本身由 node 层 `apiTypeToUseResponsesApi` 的用例守着。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { ManagedModel, ManagedModelInput } from "@/core/models/types";

const { ModelsEditDialog } =
  await import("@/components/workspace/settings/models-edit-dialog");

const M = zhCN.settings.models;

function managedModel(over: Partial<ManagedModel> = {}): ManagedModel {
  return {
    name: "mini",
    model: "minimax-m3",
    display_name: "MiniMax",
    provider: "anthropic",
    endpoint_key: "base_url",
    endpoint: "https://api.example/anthropic",
    api_key: "********",
    source: "ui",
    editable: true,
    ...over,
  };
}

function renderDialog(
  model: ManagedModel,
  onSave: (input: ManagedModelInput) => void,
) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <ModelsEditDialog
        open
        onOpenChange={() => undefined}
        model={model}
        onSave={onSave}
        isPending={false}
      />
    </I18nContext.Provider>,
  );
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));
}

afterEach(() => {
  cleanup();
});

describe("ModelsEditDialog read side", () => {
  it("shows the stored headers and max output on open, and saves them back", async () => {
    const onSave = rs.fn();
    renderDialog(
      managedModel({
        default_headers: { "x-opencode-session": "sess-1" },
        max_tokens: 8192,
      }),
      onSave,
    );

    expect(screen.getByDisplayValue("x-opencode-session")).toBeDefined();
    expect(screen.getByDisplayValue("sess-1")).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(M.maxTokens).value).toBe(
      "8192",
    );

    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input] = onSave.mock.calls[0] as [ManagedModelInput];
    expect(input.default_headers).toEqual({ "x-opencode-session": "sess-1" });
    expect(input.max_tokens).toBe(8192);
  });

  it("sends an edited header value, not the stored one", async () => {
    const onSave = rs.fn();
    renderDialog(
      managedModel({ default_headers: { "x-opencode-session": "stale" } }),
      onSave,
    );

    fireEvent.change(screen.getByDisplayValue("stale"), {
      target: { value: "fresh" },
    });
    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input] = onSave.mock.calls[0] as [ManagedModelInput];
    expect(input.default_headers).toEqual({ "x-opencode-session": "fresh" });
  });

  it("reads the API type out of use_responses_api and carries it back", async () => {
    const onSave = rs.fn();
    renderDialog(
      managedModel({ provider: "openai-compatible", use_responses_api: true }),
      onSave,
    );

    expect(screen.getByText(M.apiTypeResponses)).toBeDefined();

    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input] = onSave.mock.calls[0] as [ManagedModelInput];
    expect(input.use_responses_api).toBe(true);
  });

  it("never invents a use_responses_api key for an entry that never had one", async () => {
    const onSave = rs.fn();
    renderDialog(managedModel({ provider: "openai-compatible" }), onSave);

    expect(screen.getByText(M.apiTypeChat)).toBeDefined();

    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input] = onSave.mock.calls[0] as [ManagedModelInput];
    expect("use_responses_api" in input).toBe(false);
    expect("default_headers" in input).toBe(false);
  });

  it("still writes the anthropic recipe when only the display name is edited", async () => {
    const onSave = rs.fn();
    renderDialog(managedModel(), onSave);

    fireEvent.change(screen.getByLabelText(M.displayName), {
      target: { value: "Renamed" },
    });
    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input] = onSave.mock.calls[0] as [ManagedModelInput];
    expect(input.display_name).toBe("Renamed");
    expect(input.when_thinking_enabled).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
    expect(input.when_thinking_disabled).toEqual({
      thinking: { type: "disabled" },
    });
  });
});
