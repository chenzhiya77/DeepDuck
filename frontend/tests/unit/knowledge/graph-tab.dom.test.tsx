/**
 * 知识图谱 tab（2026-08-19 spec）：
 * - Task 2 挂载骨架：中栏第五 tab trigger/切换/forceMount keep-alive。
 * - Task 3 起面板本体（GraphTab）：力导向图 + 编码 + 钻取（本文件后续扩充）。
 *   echarts 画布（graph-canvas）在 jsdom 不可运行，整体 mock 断言 props
 *  （对齐 vector-tab.dom.test.tsx 基建）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
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
          graph={<div data-testid="graph-pane" />}
        />
      </I18nContext.Provider>
    );
  }
  return render(<Harness />);
}

const stateOf = (testid: string) =>
  screen.getByTestId(testid).closest("[data-slot='tabs-content']")?.getAttribute("data-state");

describe("MiddleTabs 知识图谱 tab 挂载（Task 2）", () => {
  beforeEach(() => {
    cleanup();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the fifth trigger labeled 知识图谱", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: "知识图谱" })).toBeTruthy();
  });

  it("activates the graph pane on trigger selection (Radix automatic mode)", () => {
    renderTabs();
    // Radix Tabs automatic 激活模式在 mousedown 触发（对齐 vector-tab 先例）。
    fireEvent.mouseDown(screen.getByRole("tab", { name: "知识图谱" }));
    expect(stateOf("graph-pane")).toBe("active");
    expect(stateOf("documents-pane")).toBe("inactive");
  });

  it("keeps all five panes mounted when switching tabs (forceMount)", () => {
    renderTabs();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "知识图谱" }));
    // 切到图谱后，其余四个 pane 仍在 DOM（keep-alive），只是 hidden。
    for (const testId of ["documents-pane", "wiki-pane", "recall-pane", "vectors-pane", "graph-pane"]) {
      expect(screen.getByTestId(testId)).toBeTruthy();
    }
    expect(stateOf("wiki-pane")).toBe("inactive");
  });
});
