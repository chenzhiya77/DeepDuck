import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RunStatusNotice } from "@/components/workspace/run-status/run-status-notice";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { FailureAction, FailureKind } from "@/core/run-status/types";

/**
 * The failure notice.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.2. Every presented kind gets its sentence verbatim, because the sentence is
 * what tells the reader what to do — that is how the copy was written, and it is
 * why only `inspect` carries a control (`details` is the one action with something
 * behind it).
 *
 * `stopped` and `none` render nothing: a stopped run is the badge's story, and
 * `none` covers success, a run in flight, and the two frontend-bug statuses.
 */
function renderNotice(
  kind: FailureKind,
  action: FailureAction | null = null,
  details?: string | null,
) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <RunStatusNotice kind={kind} action={action} details={details} />
    </I18nContext.Provider>,
  );
}

afterEach(cleanup);

describe("RunStatusNotice", () => {
  it("tells the reader to wait or stop the running task", () => {
    renderNotice("occupied", "stop");

    const notice = screen.getByTestId("run-status-notice");
    expect(notice.textContent).toContain(
      "这个会话已有一个任务在跑，等它结束或先停掉它",
    );
    expect(notice.className).toContain("text-destructive");
    // Only the gone-chat sentence carries a link; this kind's remedy is already on
    // screen in the composer.
    expect(screen.queryByTestId("run-status-list-link")).toBeNull();
  });

  it("tells the reader to pick another model", () => {
    renderNotice("config", "configure");

    expect(screen.getByTestId("run-status-notice").textContent).toContain(
      "当前模型不在允许列表里，换一个模型再试",
    );
  });

  it("tells the reader the chat is gone, and links them to the list", () => {
    renderNotice("environment", "backToList");

    expect(screen.getByTestId("run-status-notice").textContent).toContain(
      "这个会话不存在了，回到列表重新开始",
    );
    // For this kind the sentence *is* the instruction, so it is also the control:
    // no extra copy, and the reader can act where they read it.
    const link = screen.getByTestId("run-status-list-link");
    expect(link.getAttribute("href")).toBe("/workspace/chats");
    expect(link.textContent).toBe("这个会话不存在了，回到列表重新开始");
  });

  it("tells the reader to restart with the matching mode", () => {
    renderNotice("modeMismatch", "restart");

    expect(screen.getByTestId("run-status-notice").textContent).toContain(
      "这个会话的数据用了另一种存储模式，重启服务后再试",
    );
  });

  it("adds only the reason when a run failed, because the badge says the rest", () => {
    renderNotice(
      "runFailed",
      "inspect",
      "交付未达标：产出了 1 个，一个都没交出",
    );

    const notice = screen.getByTestId("run-status-notice");
    // The sentence is the badge's, on the line directly above: printing it here
    // too would say the same thing twice.
    expect(notice.textContent).not.toContain("这次没跑完");
    // The reason is the backend's own text, behind a disclosure rather than on
    // the line.
    expect(
      screen.queryByText("交付未达标：产出了 1 个，一个都没交出"),
    ).toBeNull();

    const toggle = screen.getByTestId("run-status-details-toggle");
    expect(toggle.textContent).toBe("看详情");
    fireEvent.click(toggle);
    expect(
      screen.getByText("交付未达标：产出了 1 个，一个都没交出"),
    ).toBeTruthy();
  });

  it("adds nothing for a failed run whose reason was never recorded", () => {
    renderNotice("runFailed", "inspect", null);

    expect(screen.queryByTestId("run-status-notice")).toBeNull();
  });

  it("leaves a stopped run to the badge", () => {
    renderNotice("stopped", null);

    expect(screen.queryByTestId("run-status-notice")).toBeNull();
  });

  it("renders nothing for an outcome with no sentence", () => {
    // success, a run in flight, and the two frontend-bug statuses all land here.
    renderNotice("none", null);

    expect(screen.queryByTestId("run-status-notice")).toBeNull();
  });
});
