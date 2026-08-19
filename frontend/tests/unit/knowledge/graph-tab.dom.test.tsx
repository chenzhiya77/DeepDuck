/**
 * 知识图谱 tab（2026-08-19 spec）：
 * - Task 2 挂载骨架：中栏第五 tab trigger/切换/forceMount keep-alive。
 * - Task 3 面板本体（GraphTab）：力导向图 + 编码 + 钻取。echarts 画布
 *   （graph-canvas）在 jsdom 不可运行，整体 mock 断言 props（对齐
 *   vector-tab.dom.test.tsx 基建）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { GraphTab } from "@/components/workspace/knowledge/graph-tab";
import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeGraphResponse } from "@/core/knowledge/types";

const hooksMock = rs.hoisted(() => ({
  useKnowledgeGraph: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => ({
  useKnowledgeGraph: hooksMock.useKnowledgeGraph,
}));

/** echarts 画布 mock：记录 props，不渲染（jsdom 无 WebGL/canvas）。 */
const canvasMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/graph-canvas", () => ({
  default: (props: Record<string, unknown>) => {
    canvasMock.props = props;
    return <div data-testid="graph-canvas-mock" />;
  },
}));

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

// ── Task 3：GraphTab 面板本体 ────────────────────────────────────────────

const DOCS: KnowledgeDocument[] = [
  {
    id: "d",
    kb_id: "kb-1",
    uploader_id: "user-1",
    name: "JVM 笔记.md",
    size_bytes: 128,
    storage_path: "kb-1/d",
    status: "ready",
    progress_percent: 100,
    chunk_count: 3,
    error: null,
    path_status: null,
    content_hash: null,
    created_at: "2026-08-09T10:00:00Z",
  },
];

const GRAPH: KnowledgeGraphResponse = {
  kb_id: "kb-1",
  nodes: [
    {
      id: "JVM",
      type: "组件",
      description: "Java 虚拟机",
      mention_count: 2,
      community: 0,
      source_chunk_ids: ["d#0000", "d#0001"],
    },
    { id: "堆内存", type: "概念", description: "对象实例存放区", mention_count: 1, community: 0, source_chunk_ids: ["d#0000"] },
  ],
  edges: [{ source: "JVM", target: "堆内存", relation: "包含", description: "" }],
  stats: { node_count: 2, edge_count: 1, community_count: 1 },
};

type GraphQueryResult = {
  data: KnowledgeGraphResponse | undefined;
  isLoading: boolean;
  isError: boolean;
};

function stubGraphQuery(result: GraphQueryResult) {
  hooksMock.useKnowledgeGraph.mockReturnValue(result);
}

function renderGraphTab(props: Partial<Parameters<typeof GraphTab>[0]> = {}) {
  const onOpenChunk = rs.fn();
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <GraphTab kbId="kb-1" enabled documents={DOCS} onOpenChunk={onOpenChunk} {...props} />
    </I18nContext.Provider>,
  );
  return { onOpenChunk };
}

describe("GraphTab 三态（Task 3）", () => {
  beforeEach(() => {
    cleanup();
    canvasMock.props = undefined;
    hooksMock.useKnowledgeGraph.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the loading state while the graph query is pending", () => {
    stubGraphQuery({ data: undefined, isLoading: true, isError: false });
    renderGraphTab();
    expect(screen.getByTestId("graph-loading")).toBeTruthy();
  });

  it("shows the error state when the graph query fails", () => {
    stubGraphQuery({ data: undefined, isLoading: false, isError: true });
    renderGraphTab();
    expect(screen.getByTestId("graph-error")).toBeTruthy();
  });

  it("shows the empty state when the KB has no entities", () => {
    stubGraphQuery({
      data: { kb_id: "kb-1", nodes: [], edges: [], stats: { node_count: 0, edge_count: 0, community_count: 0 } },
      isLoading: false,
      isError: false,
    });
    renderGraphTab();
    expect(screen.getByTestId("graph-empty")).toBeTruthy();
  });

  it("passes nodes/edges to the canvas once loaded", async () => {
    stubGraphQuery({ data: GRAPH, isLoading: false, isError: false });
    renderGraphTab();
    // GraphCanvas 经 next/dynamic 懒加载——props 断言需等异步挂载完成。
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    expect(canvasMock.props?.nodes).toEqual(GRAPH.nodes);
    expect(canvasMock.props?.edges).toEqual(GRAPH.edges);
  });

  it("lazy-gates the query on the enabled flag (keep-alive pane)", () => {
    stubGraphQuery({ data: GRAPH, isLoading: false, isError: false });
    renderGraphTab({ enabled: false });
    expect(hooksMock.useKnowledgeGraph).toHaveBeenCalledWith("kb-1", false);
  });
});

describe("GraphTab 实体钻取（Task 3）", () => {
  beforeEach(() => {
    cleanup();
    canvasMock.props = undefined;
    hooksMock.useKnowledgeGraph.mockReset();
    stubGraphQuery({ data: GRAPH, isLoading: false, isError: false });
  });
  afterEach(() => {
    cleanup();
  });

  it("opens the entity sheet with details and related chunks on node click", async () => {
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    const onNodeClick = canvasMock.props?.onNodeClick as (node: KnowledgeGraphResponse["nodes"][number]) => void;
    onNodeClick(GRAPH.nodes[0]!);
    // 抽屉：实体名 + 描述 + 提及次数 + 关联切片列表。
    await waitFor(() => expect(screen.getByTestId("graph-entity-sheet")).toBeTruthy());
    expect(screen.getByTestId("graph-entity-sheet").textContent).toContain("JVM");
    expect(screen.getByTestId("graph-entity-sheet").textContent).toContain("Java 虚拟机");
    expect(screen.getByTestId("graph-entity-sheet").textContent).toContain("2");
    const chunks = screen.getAllByTestId("graph-entity-chunk");
    expect(chunks).toHaveLength(2);
    // 切片条目显示所属文档名（doc_id 从 chunk_id 解析）——可辨识的跳转目标。
    expect(chunks[0]!.textContent).toContain("JVM 笔记.md");
  });

  it("dispatches onOpenChunk(docId, chunkId) when a related chunk is clicked", async () => {
    const { onOpenChunk } = renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    const onNodeClick = canvasMock.props?.onNodeClick as (node: KnowledgeGraphResponse["nodes"][number]) => void;
    onNodeClick(GRAPH.nodes[0]!);
    await waitFor(() => expect(screen.getByTestId("graph-entity-sheet")).toBeTruthy());
    fireEvent.click(screen.getAllByTestId("graph-entity-chunk")[1]!);
    expect(onOpenChunk).toHaveBeenCalledWith("d", "d#0001");
  });
});
