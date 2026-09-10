/**
 * 设置弹窗「模型」分区可见性（spec 2026-09-10 §5.7，plan Task 4）：
 * 仅 admin 在左导航看到「模型」分区；非 admin 不见（UX 门控，安全以服务端为准）。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

const authMock = rs.hoisted(() => ({ useAuth: rs.fn() }));
rs.mock("@/core/auth/AuthProvider", () => authMock);
rs.mock("@/core/models/hooks", () => ({
  useModelsConfig: rs.fn(() => ({ config: { models: [] }, isLoading: false, error: null })),
  useSaveModelsConfig: rs.fn(() => ({ mutate: rs.fn(), isPending: false })),
}));

const { SettingsDialog } = await import(
  "@/components/workspace/settings/settings-dialog"
);

function renderDialog() {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <SettingsDialog open defaultSection="models" />
    </I18nContext.Provider>,
  );
}

afterEach(() => cleanup());

describe("SettingsDialog models nav gating", () => {
  it("shows the models section for admins", () => {
    authMock.useAuth.mockReturnValue({ user: { system_role: "admin" } });
    renderDialog();
    expect(screen.getByRole("button", { name: zhCN.settings.sections.models })).toBeDefined();
  });

  it("hides the models section for non-admins", () => {
    authMock.useAuth.mockReturnValue({ user: { system_role: "user" } });
    renderDialog();
    expect(
      screen.queryByRole("button", { name: zhCN.settings.sections.models }),
    ).toBeNull();
  });
});
