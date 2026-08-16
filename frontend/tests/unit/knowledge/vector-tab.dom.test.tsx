/**
 * 向量空间 tab 挂载（2026-08-15 spec Task 5）：中栏第四 tab——trigger 渲染、
 * 切换语义、四 pane forceMount keep-alive（切走不卸载，面板状态存活）。
 * 面板本体（散点图）在 Task 6 填充，本任务只验证挂载骨架。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeBase } from "@/core/knowledge/types";

const KB: KnowledgeBase = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品资料",
  description: "",
  visibility: "private",
  created_at: "2026-08-09T10:00:00Z",
};

function renderTabs() {
  function Harness() {
    const [tab, setTab] = useState<KnowledgeMiddleTab>("documents");
    return (
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <MiddleTabs
          kb={KB}
          activeTab={tab}
          onTabChange={setTab}
          supportedSuffixes={[".md", ".pdf", ".txt"]}
          onUpload={rs.fn()}
          onGenerateWiki={rs.fn()}
          onRenameKb={rs.fn()}
          onDeleteKb={rs.fn()}
          documents={<div data-testid="documents-pane" />}
          wiki={<div data-testid="wiki-pane" />}
          recall={<div data-testid="recall-pane" />}
          vectors={<div data-testid="vectors-pane" />}
        />
      </I18nContext.Provider>
    );
  }
  render(<Harness />);
}

const stateOf = (testid: string) =>
  screen.getByTestId(testid).closest("[data-slot='tabs-content']")?.getAttribute("data-state");

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("MiddleTabs 向量空间 tab", () => {
  it("renders the fourth trigger 向量空间 alongside the existing three", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: "文档" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "百科" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "检索测试" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "向量空间" })).toBeTruthy();
  });

  it("activates the vectors pane on trigger selection (Radix automatic mode)", () => {
    renderTabs();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "向量空间" }));
    expect(stateOf("vectors-pane")).toBe("active");
    expect(stateOf("documents-pane")).toBe("inactive");
  });

  it("keeps all four panes mounted (forceMount keep-alive) after switching", () => {
    renderTabs();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "向量空间" }));
    for (const testid of ["documents-pane", "wiki-pane", "recall-pane", "vectors-pane"]) {
      expect(screen.getByTestId(testid)).toBeTruthy();
    }
    expect(stateOf("wiki-pane")).toBe("inactive");
    expect(stateOf("recall-pane")).toBe("inactive");
  });
});
