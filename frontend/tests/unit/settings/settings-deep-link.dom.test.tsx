/**
 * `?settings=<section>` 深链（deep link）：把 URL 参数翻译成「打开设置弹窗并停在该分区」。
 *
 * 这里的守卫针对一次真实漂移（2026-09-16）：允许的分区名单是手抄进
 * `workspace-settings-deep-link.tsx` 的一个 Set，抄漏了 `models` 和 `pet`，
 * 带这两个参数进来会**什么都不发生**——不报错、不提示、弹窗不开。
 *
 * 所以用例不自己维护第二份名单，而是走**左侧导航自己的那一份**（`settings.sections`
 * 的键）：将来加一个分区，这个循环自动把它纳入。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

const navMock = rs.hoisted(() => ({ query: "" }));
const paramsCache = new Map<string, URLSearchParams>();

rs.mock("next/navigation", () => ({
  usePathname: () => "/workspace/chats/new",
  useRouter: () => ({ replace: rs.fn() }),
  useSearchParams: () => {
    if (!paramsCache.has(navMock.query)) {
      paramsCache.set(navMock.query, new URLSearchParams(navMock.query));
    }
    return paramsCache.get(navMock.query)!;
  },
}));

import {
  getSettingsDialogSnapshot,
  setSettingsDialogOpen,
} from "@/components/workspace/settings/settings-dialog-store";
import { WorkspaceSettingsDeepLink } from "@/components/workspace/workspace-settings-deep-link";
import { zhCN } from "@/core/i18n/locales/zh-CN";

/** The left nav's own list — one entry per section, and the list the dialog renders from. */
const SECTIONS = Object.keys(zhCN.settings.sections);

beforeEach(() => {
  setSettingsDialogOpen(false);
});

afterEach(() => {
  cleanup();
  setSettingsDialogOpen(false);
  navMock.query = "";
});

describe("settings deep link", () => {
  it("opens the dialog on every section the nav offers", () => {
    expect(SECTIONS.length).toBeGreaterThan(0);

    for (const section of SECTIONS) {
      navMock.query = `settings=${section}`;
      const { unmount } = render(<WorkspaceSettingsDeepLink />);

      // `requested` rides along so a failure names the section that fell through.
      expect({ requested: section, ...getSettingsDialogSnapshot() }).toEqual({
        requested: section,
        open: true,
        section,
      });

      unmount();
      setSettingsDialogOpen(false);
    }
  });

  it("opens nothing for a section it does not know", () => {
    navMock.query = "settings=definitely-not-a-section";
    const before = getSettingsDialogSnapshot();
    render(<WorkspaceSettingsDeepLink />);

    // Same silent no-op, but for a value that should stay one: the store is untouched, so
    // neither the dialog nor the section it would show moved.
    expect(getSettingsDialogSnapshot()).toEqual(before);
  });
});
