/**
 * Middle-column tab container + read-only wiki entries (phase-2 batch-1):
 * library-level header row (name + overflow menu: generate wiki / rename /
 * delete), the 文档|百科 tab strip, and keep-alive panes (switching must not
 * unmount the document table — its search/selection state and indexing
 * polling survive). The wiki panel lists entries (title/summary/dirty/
 * updated_at) and opens the right-side drawer for the full text; the drawer
 * offers a secondary "在百科 tab 中查看" reveal action.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

rs.mock("@/core/knowledge/hooks", () => ({
  useWikiEntry: rs.fn(),
}));

import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { WikiEntryDrawer } from "@/components/workspace/knowledge/wiki-entry-drawer";
import { WikiPanel } from "@/components/workspace/knowledge/wiki-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { useWikiEntry } from "@/core/knowledge/hooks";
import type { KnowledgeBase, WikiEntryDetail, WikiEntrySummary } from "@/core/knowledge/types";

const KB: KnowledgeBase = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品资料",
  description: "",
  visibility: "private",
  created_at: "2026-08-09T10:00:00Z",
};

const ENTRY: WikiEntrySummary = {
  id: "entry-1",
  title: "DeerFlow",
  summary: "DeerFlow 是一个 LangGraph 超级代理系统……",
  status: "ready",
  updated_at: "2026-08-10T08:00:00Z",
};

const DIRTY_ENTRY: WikiEntrySummary = {
  id: "entry-2",
  title: "Gateway",
  summary: "网关负责统一鉴权与路由。",
  status: "dirty",
  updated_at: "2026-08-10T09:00:00Z",
};

function renderWithI18n(node: React.ReactNode) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {node}
    </I18nContext.Provider>,
  );
}

function renderTabs(props?: Partial<Parameters<typeof MiddleTabs>[0]>) {
  const handlers = {
    onUpload: rs.fn(),
    onGenerateWiki: rs.fn(),
    onRenameKb: rs.fn().mockResolvedValue(undefined),
    onDeleteKb: rs.fn().mockResolvedValue(undefined),
  };
  function Harness() {
    const [tab, setTab] = useState<KnowledgeMiddleTab>(props?.activeTab ?? "documents");
    return (
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <MiddleTabs
          kb={KB}
          activeTab={tab}
          onTabChange={setTab}
          documents={<div data-testid="documents-pane">文档内容</div>}
          wiki={<div data-testid="wiki-pane">百科内容</div>}
          {...handlers}
          {...props}
        />
      </I18nContext.Provider>
    );
  }
  render(<Harness />);
  return handlers;
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("MiddleTabs", () => {
  it("renders the library header row (name + overflow menu) above the tab strip", () => {
    renderTabs();
    expect(screen.getByText("产品资料")).toBeTruthy();
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "文档" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "百科" })).toBeTruthy();
  });

  it("keeps both panes mounted (keep-alive) and hides the inactive one", () => {
    renderTabs();
    const documentsPane = screen.getByTestId("documents-pane");
    const wikiPane = screen.getByTestId("wiki-pane");
    // Both mounted (forceMount); visibility rides data-state + the
    // data-[state=inactive]:hidden class, not the hidden attribute.
    const stateOf = (node: HTMLElement) =>
      node.closest("[data-slot='tabs-content']")?.getAttribute("data-state");
    expect(stateOf(documentsPane)).toBe("active");
    expect(stateOf(wikiPane)).toBe("inactive");

    // Radix activates a tab trigger on mouseDown (automatic mode), not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "百科" }));

    expect(stateOf(screen.getByTestId("wiki-pane"))).toBe("active");
    expect(stateOf(screen.getByTestId("documents-pane"))).toBe("inactive");
    // still in the DOM — state/polling survive the switch
    expect(screen.getByText("文档内容")).toBeTruthy();
  });

  it("carries library-level actions in the overflow menu (incl. upload — a library action)", async () => {
    const clickSpy = rs
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    try {
      const handlers = renderTabs();
      fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
      fireEvent.click(await screen.findByText("上传文档"));
      expect(clickSpy).toHaveBeenCalled();
      // selecting an item closes the menu — reopen for the next action
      fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
      fireEvent.click(await screen.findByText("生成百科"));
      expect(handlers.onGenerateWiki).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("uploads via the hidden file input in the library header", () => {
    const handlers = renderTabs();
    const input = screen.getByTestId("document-upload-input");
    const file = new File(["x"], "新手册.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(handlers.onUpload).toHaveBeenCalledWith([file]);
  });

  it("renames the kb through the overflow menu dialog", async () => {
    const handlers = renderTabs();
    fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("重命名知识库"));
    // The dialog opens deferred (runAfterMenuClose) once the menu's dismissal
    // layer has torn down, so wait for it asynchronously.
    fireEvent.change(await screen.findByDisplayValue("产品资料"), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(handlers.onRenameKb).toHaveBeenCalledWith("新名称");
  });

  it("deletes the kb only after the cascade-warning confirm", async () => {
    const handlers = renderTabs();
    fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("删除知识库"));
    expect(await screen.findByText(/将同时删除全部文档、切片、向量、图谱与百科条目/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(handlers.onDeleteKb).toHaveBeenCalled();
  });
});

describe("WikiPanel", () => {
  it("renders entries with title, summary, dirty badge and updated time", () => {
    renderWithI18n(<WikiPanel entries={[ENTRY, DIRTY_ENTRY]} onOpenEntry={() => undefined} />);
    expect(screen.getByText("DeerFlow")).toBeTruthy();
    expect(screen.getByText(/LangGraph 超级代理系统/)).toBeTruthy();
    expect(screen.getByText("Gateway")).toBeTruthy();
    // dirty badge only on the dirty entry
    expect(screen.getAllByText("待更新")).toHaveLength(1);
    expect(screen.getAllByText(/更新于/)).toHaveLength(2);
  });

  it("invokes onOpenEntry with the clicked entry", () => {
    const onOpenEntry = rs.fn();
    renderWithI18n(<WikiPanel entries={[ENTRY]} onOpenEntry={onOpenEntry} />);
    fireEvent.click(screen.getByText("DeerFlow"));
    expect(onOpenEntry).toHaveBeenCalledWith(ENTRY);
  });

  it("shows the empty-state copy when the kb has no entries", () => {
    renderWithI18n(<WikiPanel entries={[]} onOpenEntry={() => undefined} />);
    expect(screen.getByText(/还没有百科条目/)).toBeTruthy();
  });
});

describe("WikiEntryDrawer", () => {
  const DETAIL: WikiEntryDetail = {
    id: "entry-1",
    kb_id: "kb-1",
    title: "DeerFlow",
    content: "完整条目正文。\n\n第二段。",
    status: "ready",
    source_chunk_ids: ["d#0000"],
    updated_at: "2026-08-10T08:00:00Z",
  };

  it("loads the full entry when opened and renders title + content", async () => {
    rs.mocked(useWikiEntry).mockReturnValue({ data: DETAIL, isLoading: false } as never);
    renderWithI18n(
      <WikiEntryDrawer kbId="kb-1" entryId="entry-1" open onOpenChange={() => undefined} />,
    );
    expect(await screen.findByText("DeerFlow")).toBeTruthy();
    expect(screen.getByText(/完整条目正文/)).toBeTruthy();
    expect(rs.mocked(useWikiEntry).mock.calls[0]?.slice(0, 2)).toEqual(["kb-1", "entry-1"]);
  });

  it("offers the secondary reveal action (在百科 tab 中查看)", async () => {
    rs.mocked(useWikiEntry).mockReturnValue({ data: DETAIL, isLoading: false } as never);
    const onRevealInTab = rs.fn();
    renderWithI18n(
      <WikiEntryDrawer
        kbId="kb-1"
        entryId="entry-1"
        open
        onOpenChange={() => undefined}
        onRevealInTab={onRevealInTab}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "在百科 tab 中查看" }));
    expect(onRevealInTab).toHaveBeenCalledWith("entry-1");
  });
});
