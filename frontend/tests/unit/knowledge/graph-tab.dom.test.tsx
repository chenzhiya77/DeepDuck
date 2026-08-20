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
import type {
  GraphRetrievalOverlay,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
} from "@/core/knowledge/types";

const hooksMock = rs.hoisted(() => ({
  useKnowledgeGraph: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => ({
  useKnowledgeGraph: hooksMock.useKnowledgeGraph,
}));

// 搜索无命中提示走 sonner toast。
rs.mock("sonner", () => ({
  toast: { info: rs.fn(), success: rs.fn(), warning: rs.fn(), error: rs.fn() },
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
  const element = (extra: Partial<Parameters<typeof GraphTab>[0]> = {}) => (
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <GraphTab kbId="kb-1" enabled documents={DOCS} onOpenChunk={onOpenChunk} {...props} {...extra} />
    </I18nContext.Provider>
  );
  const utils = render(element());
  return { onOpenChunk, ...utils, rerenderWith: (extra: Partial<Parameters<typeof GraphTab>[0]>) => utils.rerender(element(extra)) };
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

// ── Task 4（P3）：搜索定位 / 着色切换 / 局部图模式 ─────────────────────────

/** 链式图：A — B — C — D + 孤立 E（B 的一跳={A,C}，两跳={A,C,D}）。 */
const CHAIN_GRAPH: KnowledgeGraphResponse = {
  kb_id: "kb-1",
  nodes: (["A", "B", "C", "D", "E"] as const).map((id) => ({
    id,
    type: id === "A" ? "组件" : "概念",
    description: `${id} 描述`,
    mention_count: 1,
    community: id === "E" ? 1 : 0,
    source_chunk_ids: ["d#0000"],
  })),
  edges: [
    { source: "A", target: "B", relation: "r", description: "" },
    { source: "B", target: "C", relation: "r", description: "" },
    { source: "C", target: "D", relation: "r", description: "" },
  ],
  stats: { node_count: 5, edge_count: 3, community_count: 2 },
};

describe("GraphTab 搜索 / 着色 / 局部图（Task 4）", () => {
  beforeEach(() => {
    cleanup();
    canvasMock.props = undefined;
    hooksMock.useKnowledgeGraph.mockReset();
    stubGraphQuery({ data: CHAIN_GRAPH, isLoading: false, isError: false });
  });
  afterEach(() => {
    cleanup();
  });

  const canvasNodeIds = () => (canvasMock.props?.nodes as KnowledgeGraphNode[]).map((n) => n.id).sort();
  const dblClickNode = (nodeId: string) => {
    const handler = canvasMock.props?.onNodeDblClick as (node: KnowledgeGraphNode) => void;
    handler(CHAIN_GRAPH.nodes.find((n) => n.id === nodeId)!);
  };

  it("defaults to community coloring and switches to type coloring via the toggle", async () => {
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    expect(canvasMock.props?.colorBy).toBe("community"); // spec §6：默认按社区
    fireEvent.click(screen.getByRole("radio", { name: "按类型" }));
    await waitFor(() => expect(canvasMock.props?.colorBy).toBe("type"));
  });

  it("focuses the first fuzzy-matched node on search submit", async () => {
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    fireEvent.change(screen.getByLabelText("搜索实体"), { target: { value: "b" } });
    fireEvent.submit(screen.getByLabelText("搜索实体").closest("form")!);
    await waitFor(() => expect(canvasMock.props?.focusNode).toBe("B"));
  });

  it("toasts when the search has no match", async () => {
    const { toast } = await import("sonner");
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    fireEvent.change(screen.getByLabelText("搜索实体"), { target: { value: "不存在" } });
    fireEvent.submit(screen.getByLabelText("搜索实体").closest("form")!);
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(canvasMock.props?.focusNode).toBeFalsy();
  });

  it("enters neighborhood mode on node double-click (1 hop) with a breadcrumb back", async () => {
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    expect(canvasNodeIds()).toEqual(["A", "B", "C", "D", "E"]);

    dblClickNode("B");
    // 局部图：只剩 B + 一跳邻居 {A,C}；面包屑出现。
    await waitFor(() => expect(screen.getByTestId("graph-breadcrumb")).toBeTruthy());
    expect(canvasNodeIds()).toEqual(["A", "B", "C"]);
    expect(screen.getByTestId("graph-breadcrumb").textContent).toContain("B");

    // 面包屑返回全局图。
    fireEvent.click(screen.getByTestId("graph-breadcrumb-back"));
    await waitFor(() => expect(canvasNodeIds()).toEqual(["A", "B", "C", "D", "E"]));
  });

  it("widens the neighborhood to 2 hops via the hop toggle", async () => {
    renderGraphTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    dblClickNode("B");
    await waitFor(() => expect(canvasNodeIds()).toEqual(["A", "B", "C"]));
    fireEvent.click(screen.getByRole("radio", { name: "2 跳" }));
    await waitFor(() => expect(canvasNodeIds()).toEqual(["A", "B", "C", "D"])); // E 孤立不进
  });
});

// ── Task 5（P4，spec §7）：graph_search 检索路径叠加 ────────────────────────

const GRAPH_CHAT_OVERLAY: GraphRetrievalOverlay = {
  source: "chat",
  text: "B 和 D 什么关系？",
  trace: {
    seed_entities: ["B"],
    expanded_nodes: [
      { name: "A", hop: 1 },
      { name: "C", hop: 1 },
    ],
    evidence_entities: ["B", "C"],
  },
};

describe("GraphTab 检索路径叠加（Task 5 P4）", () => {
  beforeEach(() => {
    cleanup();
    canvasMock.props = undefined;
    hooksMock.useKnowledgeGraph.mockReset();
    stubGraphQuery({ data: CHAIN_GRAPH, isLoading: false, isError: false });
  });
  afterEach(() => {
    cleanup();
  });

  it("applies the chat overlay to the canvas and shows the three-layer badge", async () => {
    renderGraphTab({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(canvasMock.props?.overlay).toEqual(GRAPH_CHAT_OVERLAY.trace));
    const badge = screen.getByTestId("graph-overlay-badge");
    expect(badge.textContent).toContain("B 和 D 什么关系？");
    // 徽标三层计数：种子 m · 扩展 n · 证据 k。
    expect(badge.textContent).toContain("种子 1");
    expect(badge.textContent).toContain("扩展 2");
    expect(badge.textContent).toContain("证据 2");
  });

  it("clears the overlay via the badge × button", async () => {
    renderGraphTab({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(screen.getByTestId("graph-overlay-badge")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("清除路径高亮"));
    await waitFor(() => expect(canvasMock.props?.overlay ?? null).toBeNull());
    expect(screen.queryByTestId("graph-overlay-badge")).toBeNull();
  });

  it("drops the overlay when the graph fingerprint drifts（node/edge 计数变化）", async () => {
    const { toast } = await import("sonner");
    const { rerenderWith } = renderGraphTab({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(screen.getByTestId("graph-overlay-badge")).toBeTruthy());

    // 图数据变化（新实体加入）→ 指纹漂移 → 叠加清除 + 提示。
    const grown: KnowledgeGraphResponse = {
      ...CHAIN_GRAPH,
      nodes: [
        ...CHAIN_GRAPH.nodes,
        { id: "F", type: "概念", description: "新实体", mention_count: 1, community: 0, source_chunk_ids: ["d#0000"] },
      ],
      stats: { node_count: 6, edge_count: 3, community_count: 2 },
    };
    hooksMock.useKnowledgeGraph.mockReturnValue({ data: grown, isLoading: false, isError: false });
    rerenderWith({ overlay: GRAPH_CHAT_OVERLAY });

    await waitFor(() => expect(screen.queryByTestId("graph-overlay-badge")).toBeNull());
    expect(canvasMock.props?.overlay ?? null).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("图谱内容已更新，检索路径高亮已清除");
  });

  it("freezes chat overlays while 跟随对话 is off and applies the latest when re-enabled", async () => {
    const { rerenderWith } = renderGraphTab({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(screen.getByTestId("graph-overlay-badge").textContent).toContain("B 和 D"));

    // 关闭「跟随对话」→ 新一轮 chat overlay 冻结（徽标保持旧轮，画布不更新）。
    fireEvent.click(screen.getByRole("switch", { name: "跟随对话" }));
    const next: GraphRetrievalOverlay = { ...GRAPH_CHAT_OVERLAY, text: "新一轮提问" };
    rerenderWith({ overlay: next });
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    expect(screen.getByTestId("graph-overlay-badge").textContent).toContain("B 和 D");
    expect(screen.getByTestId("graph-overlay-badge").textContent).not.toContain("新一轮");

    // 重新打开 → 应用冻结期间到达的最新一轮。
    fireEvent.click(screen.getByRole("switch", { name: "跟随对话" }));
    await waitFor(() => expect(screen.getByTestId("graph-overlay-badge").textContent).toContain("新一轮提问"));
  });

  it("does not re-apply the same overlay object twice（恒等去重）", async () => {
    const { rerenderWith } = renderGraphTab({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(canvasMock.props?.overlay).toEqual(GRAPH_CHAT_OVERLAY.trace));
    // 清除后同对象重渲染 → 不复活（consumed 去重）。
    fireEvent.click(screen.getByLabelText("清除路径高亮"));
    await waitFor(() => expect(screen.queryByTestId("graph-overlay-badge")).toBeNull());
    rerenderWith({ overlay: GRAPH_CHAT_OVERLAY });
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    expect(screen.queryByTestId("graph-overlay-badge")).toBeNull();
  });
});
