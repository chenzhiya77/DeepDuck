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
