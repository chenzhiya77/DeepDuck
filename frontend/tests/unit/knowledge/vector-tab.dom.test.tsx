/**
 * 向量空间 tab（2026-08-15 spec）：
 * - Task 5 挂载骨架：中栏第四 tab trigger/切换/forceMount keep-alive。
 * - Task 6 面板本体（VectorTab）：工具栏（collection chips / 2D·3D / 算法 /
 *   重新计算）+ 加载·空·错误三态 + 索引中提示 + 着色分组（chunk=文档、
 *   entity=类型、wiki/card 单色）+ 点击联动现有抽屉链路。echarts 画布
 *   （vector-canvas）在 jsdom 不可运行，整体 mock 断言 props。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { VectorTab } from "@/components/workspace/knowledge/vector-tab";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { useProjectVectorQuery, useVectorProjection } from "@/core/knowledge/hooks";
import type { KnowledgeBase, VectorProjectionResponse } from "@/core/knowledge/types";

const hooksMock = rs.hoisted(() => ({
  useVectorProjection: rs.fn(),
  useProjectVectorQuery: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => ({
  useVectorProjection: hooksMock.useVectorProjection,
  useProjectVectorQuery: hooksMock.useProjectVectorQuery,
}));

/** echarts 画布 mock：记录 props，不渲染（jsdom 无 WebGL/canvas）。 */
const canvasMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/vector-canvas", () => ({
  default: (props: Record<string, unknown>) => {
    canvasMock.props = props;
    return null;
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

// ── Task 6: VectorTab 面板本体 ────────────────────────────────────────────

const PROJECTION: VectorProjectionResponse = {
  kb_id: "kb-1",
  algo: "pca",
  dims: 2,
  model_version: "pca-v1",
  fingerprint: "sha1:abc",
  cached: false,
  computed_ms: 42,
  total_points: 7,
  shown_points: 7,
  sampled: false,
  points: [
    { id: "doc-1#0000", source_type: "chunk", x: 0.1, y: 0.2, label: "a.pdf", color_key: "doc-1", preview: "第一章切片" },
    { id: "doc-1#0001", source_type: "chunk", x: 0.2, y: 0.3, label: "a.pdf", color_key: "doc-1", preview: "第二章切片" },
    { id: "doc-2#0000", source_type: "chunk", x: 0.9, y: 0.8, label: "b.pdf", color_key: "doc-2", preview: "另一文档" },
    { id: "JVM", source_type: "entity", x: 0.5, y: 0.5, label: "JVM", color_key: "概念", preview: "Java 虚拟机" },
    { id: "GC", source_type: "entity", x: 0.6, y: 0.4, label: "GC", color_key: "概念", preview: "垃圾回收" },
    { id: "entry-1", source_type: "wiki", x: 0.4, y: 0.6, label: "JVM 条目", color_key: "wiki", preview: "JVM 条目" },
    { id: "card-1", source_type: "card", x: 0.3, y: 0.7, label: "速记", color_key: "card", preview: "速记" },
  ],
};

function mockProjectionQuery(value: Partial<ReturnType<typeof useVectorProjection>>) {
  hooksMock.useVectorProjection.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...value,
  });
}

function renderVectorTab(props?: Partial<Parameters<typeof VectorTab>[0]>) {
  const handlers = {
    onOpenChunk: rs.fn(),
    onOpenWikiEntry: rs.fn(),
    onOpenManualCard: rs.fn(),
  };
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <VectorTab kbId="kb-1" enabled indexingCount={0} {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return handlers;
}

describe("VectorTab 面板", () => {
  beforeEach(() => {
    canvasMock.props = undefined;
    hooksMock.useProjectVectorQuery.mockReturnValue({ mutate: rs.fn(), isPending: false });
    mockProjectionQuery({ data: PROJECTION });
  });

  it("shows the computing placeholder while the projection loads", () => {
    mockProjectionQuery({ isLoading: true });
    renderVectorTab();
    expect(screen.getByText("计算投影中…")).toBeTruthy();
    expect(canvasMock.props).toBeUndefined();
  });

  it("renders the empty-state guidance for a kb without vectors (no canvas)", () => {
    mockProjectionQuery({ data: { ...PROJECTION, points: [], total_points: 0 } });
    renderVectorTab();
    expect(screen.getByText(/还没有向量数据/)).toBeTruthy();
    expect(canvasMock.props).toBeUndefined();
  });

  it("surfaces the backend error detail on failure (e.g. umap extra missing)", () => {
    mockProjectionQuery({ isError: true, error: new Error("umap-learn is not installed") });
    renderVectorTab();
    expect(screen.getByText(/投影加载失败/)).toBeTruthy();
    expect(screen.getByText(/umap-learn is not installed/)).toBeTruthy();
  });

  it("renders the toolbar: 4 collection chips, 2D/3D toggle, algo select, recompute", () => {
    renderVectorTab();
    for (const name of ["切片", "实体", "百科", "卡片"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Radix ToggleGroup single 模式的 Item 带 role="radio"（button 元素上覆写）。
    expect(screen.getByRole("radio", { name: "2D" })).toBeTruthy();
    // 3D 与重新计算在 Task 7 接通——本任务只渲染禁用态。
    expect(screen.getByRole("radio", { name: "3D" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "重新计算" })).toHaveProperty("disabled", true);
    expect(screen.getByText("算法")).toBeTruthy();
  });

  it("groups points into legend series: chunk=doc, entity=type, wiki/card single color", async () => {
    renderVectorTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    const series = canvasMock.props!.series as Array<{ key: string; sourceType: string; label: string; points: unknown[] }>;
    expect(series).toHaveLength(5);
    const byKey = new Map(series.map((s) => [s.key, s]));
    // chunk 按文档分组，图例名为文档名
    expect(byKey.get("doc-1")?.sourceType).toBe("chunk");
    expect(byKey.get("doc-1")?.label).toBe("a.pdf");
    expect(byKey.get("doc-1")?.points).toHaveLength(2);
    expect(byKey.get("doc-2")?.points).toHaveLength(1);
    // entity 按类型聚合为一组
    expect(byKey.get("概念")?.sourceType).toBe("entity");
    expect(byKey.get("概念")?.points).toHaveLength(2);
    // wiki / card 各自单色单组
    expect(byKey.get("wiki")?.points).toHaveLength(1);
    expect(byKey.get("card")?.points).toHaveLength(1);
  });

  it("passes dims=2 and the full collection selection to the projection query", () => {
    renderVectorTab();
    expect(hooksMock.useVectorProjection).toHaveBeenCalledWith(
      "kb-1",
      expect.objectContaining({ algo: "pca", dims: 2, collections: ["chunks", "entities", "wiki", "cards"] }),
      true,
    );
  });

  it("drops a collection from the query params when its chip is toggled off", () => {
    renderVectorTab();
    fireEvent.click(screen.getByRole("button", { name: "切片" }));
    const lastCall = hooksMock.useVectorProjection.mock.calls.at(-1);
    expect(lastCall?.[1].collections).toEqual(["entities", "wiki", "cards"]);
  });

  it("switches the algo param when the algorithm select changes to umap", () => {
    renderVectorTab();
    // jsdom 无 pointerCapture——对齐 human-input-card 先例用键盘打开 Radix Select。
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "UMAP" }));
    const lastCall = hooksMock.useVectorProjection.mock.calls.at(-1);
    expect(lastCall?.[1].algo).toBe("umap");
  });

  it("gates the projection query with the enabled flag (lazy tab activation)", () => {
    renderVectorTab({ enabled: false });
    expect(hooksMock.useVectorProjection).toHaveBeenCalledWith("kb-1", expect.anything(), false);
  });

  it("routes point clicks to the existing drawer chains (chunk/wiki/card), entity inert", async () => {
    const handlers = renderVectorTab();
    await waitFor(() => expect(canvasMock.props).toBeTruthy());
    const onPointClick = canvasMock.props!.onPointClick as (point: unknown) => void;

    onPointClick(PROJECTION.points[0]); // chunk: color_key=doc_id, id=chunk_id
    expect(handlers.onOpenChunk).toHaveBeenCalledWith("doc-1", "doc-1#0000");

    onPointClick(PROJECTION.points[5]); // wiki: id=entry_id
    expect(handlers.onOpenWikiEntry).toHaveBeenCalledWith("entry-1");

    onPointClick(PROJECTION.points[6]); // card: id=card_id
    expect(handlers.onOpenManualCard).toHaveBeenCalledWith("card-1");

    handlers.onOpenChunk.mockClear();
    handlers.onOpenWikiEntry.mockClear();
    handlers.onOpenManualCard.mockClear();
    onPointClick(PROJECTION.points[3]); // entity: 无抽屉目标——不触发任何联动
    expect(handlers.onOpenChunk).not.toHaveBeenCalled();
    expect(handlers.onOpenWikiEntry).not.toHaveBeenCalled();
    expect(handlers.onOpenManualCard).not.toHaveBeenCalled();
  });

  it("shows the indexing hint while documents are still being indexed", () => {
    renderVectorTab({ indexingCount: 2 });
    expect(screen.getByText(/2 个文档索引中/)).toBeTruthy();
  });
});
