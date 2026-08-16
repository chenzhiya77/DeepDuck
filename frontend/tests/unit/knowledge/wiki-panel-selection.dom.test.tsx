/**
 * Wiki panel split-section interactions (wiki tab redesign): the AI entries
 * section is collapsible (default expanded, auto-expands when a unified
 * search query matches), filters client-side by the shared query, and carries
 * the document-table interaction model — checkbox multi-select with a batch
 * bar, batch delete through the shared confirm dialog, and a Radix context
 * menu (open / edit / delete; batch variant inside a multi-selection).
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WikiPanel } from "@/components/workspace/knowledge/wiki-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { WikiEntrySummary } from "@/core/knowledge/types";

function entry(partial: Partial<WikiEntrySummary>): WikiEntrySummary {
  return {
    id: "entry-1",
    title: "DeerFlow",
    summary: "LangGraph 超级代理系统",
    status: "ready",
    updated_at: "2026-08-10T08:00:00Z",
    ...partial,
  };
}

const ENTRIES = [
  entry({ id: "a", title: "DeerFlow", summary: "超级代理系统" }),
  entry({ id: "b", title: "Gateway", summary: "网关负责统一鉴权与路由" }),
  entry({ id: "c", title: "沙箱", summary: "代码在隔离沙箱中执行" }),
];

function renderPanel(props?: Partial<Parameters<typeof WikiPanel>[0]>) {
  const handlers = {
    onOpenEntry: rs.fn(),
    onDeleteEntry: rs.fn(),
    onEditEntry: rs.fn(),
  };
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <WikiPanel entries={ENTRIES} {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return handlers;
}

afterEach(async () => {
  // happy-dom crashes when cleanup unmounts the tree while a Radix context
  // menu is still open or animating closed; always settle the menu first.
  if (document.querySelector('[role="menu"]')) {
    fireEvent.keyDown(document.body, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  cleanup();
});

describe("WikiPanel section collapse", () => {
  it("is expanded by default and collapses via the section header", () => {
    renderPanel();
    expect(screen.getByText("DeerFlow")).toBeTruthy();

    fireEvent.click(screen.getByTestId("wiki-entries-toggle"));
    expect(screen.queryByText("DeerFlow")).toBeNull();

    fireEvent.click(screen.getByTestId("wiki-entries-toggle"));
    expect(screen.getByText("DeerFlow")).toBeTruthy();
  });

  it("auto-expands a collapsed section while the search query matches", () => {
    renderPanel({ query: "网关" });
    fireEvent.click(screen.getByTestId("wiki-entries-toggle")); // user collapse
    // 有匹配（Gateway 摘要含"网关"）→ 搜索期间强制展开
    expect(screen.getByText("Gateway")).toBeTruthy();
    expect(screen.queryByText("DeerFlow")).toBeNull(); // 非匹配项被过滤
  });
});

describe("WikiPanel search filtering", () => {
  it("filters entries by title and summary (case-insensitive)", () => {
    renderPanel({ query: "gateway" });
    expect(screen.getByText("Gateway")).toBeTruthy();
    expect(screen.queryByText("DeerFlow")).toBeNull();
    expect(screen.queryByText("沙箱")).toBeNull();
  });

  it("matches against the summary too", () => {
    renderPanel({ query: "沙箱中执行" });
    expect(screen.getByText("沙箱")).toBeTruthy();
    expect(screen.queryByText("Gateway")).toBeNull();
  });

  it("shows the no-match empty state when nothing matches", () => {
    renderPanel({ query: "不存在的词" });
    expect(screen.getByText("没有匹配的条目")).toBeTruthy();
    expect(screen.queryByText("DeerFlow")).toBeNull();
  });
});

describe("WikiPanel selection", () => {
  it("selects rows via checkboxes and shows the batch bar", () => {
    renderPanel();
    expect(screen.queryByTestId("wiki-batch-bar")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: DeerFlow" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: 沙箱" }));
    expect(screen.getByTestId("wiki-batch-bar").textContent).toContain("已选 2 项");
    fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
    expect(screen.queryByTestId("wiki-batch-bar")).toBeNull();
  });

  it("selects all rows via the header checkbox", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
    expect(screen.getByTestId("wiki-batch-bar").textContent).toContain("已选 3 项");
  });

  it("clears the selection when the query changes", () => {
    const { rerender } = render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <WikiPanel entries={ENTRIES} query="" onOpenEntry={rs.fn()} onDeleteEntry={rs.fn()} />
      </I18nContext.Provider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: DeerFlow" }));
    expect(screen.getByTestId("wiki-batch-bar")).toBeTruthy();

    rerender(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <WikiPanel entries={ENTRIES} query="网关" onOpenEntry={rs.fn()} onDeleteEntry={rs.fn()} />
      </I18nContext.Provider>,
    );
    expect(screen.queryByTestId("wiki-batch-bar")).toBeNull();
  });

  it("batch-deletes the selected entries after confirm", async () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: DeerFlow" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: Gateway" }));
    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // 批量确认文案带计数，且保留再生成语义
    expect(await screen.findByText("删除 2 条百科条目？")).toBeTruthy();
    expect(screen.getByText(/下次生成时会按最新材料重新创建/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(handlers.onDeleteEntry).toHaveBeenCalledTimes(2));
    const deleted = handlers.onDeleteEntry.mock.calls.map((call) => (call[0] as WikiEntrySummary).id);
    expect(deleted).toContain("a");
    expect(deleted).toContain("b");
  });
});

describe("WikiPanel context menu", () => {
  // NOTE: under happy-dom a Radix context menu can only complete ONE
  // open/close cycle per mounted tree — each test below performs exactly one
  // cycle and fully settles before cleanup (same constraint as the document
  // table's selection tests).
  const settleMenu = async () => {
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
  };

  it("offers single-row actions on an unselected row and routes 打开详情", async () => {
    const handlers = renderPanel();
    fireEvent.contextMenu(screen.getByTestId("wiki-entry-row-b"));
    expect(await screen.findByRole("menuitem", { name: "打开详情" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "编辑条目" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "删除条目" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "打开详情" }));
    await waitFor(() => expect(handlers.onOpenEntry).toHaveBeenCalledWith(ENTRIES[1]), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  it("right-clicking an unselected row selects just that row", async () => {
    renderPanel();
    fireEvent.contextMenu(screen.getByTestId("wiki-entry-row-b"));
    expect(await screen.findByRole("menuitem", { name: "打开详情" })).toBeTruthy();
    // 单选该行 → 批量 bar 显示已选 1 项
    expect(screen.getByTestId("wiki-batch-bar").textContent).toContain("已选 1 项");
    await settleMenu();
  });

  it("offers batch actions when right-clicking inside a multi-selection", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: DeerFlow" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择条目: Gateway" }));
    fireEvent.contextMenu(screen.getByTestId("wiki-entry-row-a"));
    expect(await screen.findByRole("menuitem", { name: "删除所选" })).toBeTruthy();
    expect(screen.getAllByText("已选 2 项").length).toBeGreaterThan(0);
    await settleMenu();
  });
});
