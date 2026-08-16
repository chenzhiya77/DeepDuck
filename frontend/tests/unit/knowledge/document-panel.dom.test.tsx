/**
 * Middle column of the knowledge page (spec §5.2/§3.6): kb header actions,
 * the document table (名称/上传者/大小/切片数/状态/时间/操作), the aggregated
 * bottom stats row, drag-drop upload, cascade-warning delete confirms, and
 * failed-doc retry. Presentational — data/mutations arrive via props.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";

import { DocumentPanel, PathStatusBreakdown } from "@/components/workspace/knowledge/document-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { pathStatusLines } from "@/core/knowledge/path-status";
import type { KnowledgeBase, KnowledgeDocument } from "@/core/knowledge/types";

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn() },
}));

const KB: KnowledgeBase = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品资料",
  description: "",
  visibility: "private",
  created_at: "2026-08-09T10:00:00Z",
};

function doc(partial: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc-1",
    kb_id: "kb-1",
    uploader_id: "user-1",
    name: "产品手册.pdf",
    size_bytes: 2048,
    storage_path: "p",
    status: "ready",
    progress_percent: 100,
    chunk_count: 12,
    error: null,
    path_status: null,
    content_hash: null,
    created_at: "2026-08-09T10:00:00Z",
    ...partial,
  };
}

function renderPanel(props?: Partial<Parameters<typeof DocumentPanel>[0]>) {
  const handlers = {
    onUpload: rs.fn(),
    onDeleteDocument: rs.fn().mockResolvedValue(undefined),
    onRetryDocument: rs.fn(),
    onOpenChunks: rs.fn(),
  };
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <DocumentPanel kb={KB} documents={[doc({})]} supportedSuffixes={[".md", ".pdf", ".txt"]} {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return handlers;
}

afterEach(cleanup);

describe("DocumentPanel toolbar", () => {
  it("keeps the toolbar lean: search + sort only (upload/settings live in MiddleTabs)", () => {
    renderPanel();
    expect(screen.getByLabelText("搜索文档…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "排序方式" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "上传文档" })).toBeNull();
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
    expect(screen.queryByText("生成百科")).toBeNull();
  });

  it("matches the wiki tab's toolbar height (sort trigger sized to the h-7 search input)", () => {
    renderPanel();
    // icon-sm（size-8/32px）比搜索框 h-7（28px）高，会把工具栏撑高 4px——
    // 覆盖为 size-7 与 wiki tab 搜索栏行高对齐。
    const sortTrigger = screen.getByRole("button", { name: "排序方式" });
    expect(sortTrigger.className).toContain("size-7");
  });
});

describe("DocumentPanel table", () => {
  it("renders the six columns with formatted values", () => {
    renderPanel();
    expect(screen.getByText("名称")).toBeTruthy();
    expect(screen.getByText("上传者")).toBeTruthy();
    expect(screen.getByText("大小")).toBeTruthy();
    expect(screen.getByText("切片数")).toBeTruthy();
    expect(screen.getByText("状态")).toBeTruthy();
    expect(screen.getByText("时间")).toBeTruthy();
    expect(screen.getByText("产品手册.pdf")).toBeTruthy();
    expect(screen.getByText("我")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("就绪")).toBeTruthy();
  });

  it("renders the em-dash placeholder while chunk_count is null", () => {
    renderPanel({ documents: [doc({ status: "indexing", progress_percent: 40, chunk_count: null })] });
    expect(screen.getByText("—")).toBeTruthy();
    // exact match pins the status badge (the stats row reads "索引中 1")
    expect(screen.getByText("索引中")).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });

  it("hides the percent for pre-indexing stages (no real progress source there)", () => {
    // 2026-08-12 体验修正：待解析/解析中/切片中无可测进度（MinerU 单次调用无
    // 回调），只显示阶段徽章，不挂无信息量的 0%
    renderPanel({
      documents: [
        doc({
          status: "parsing",
          progress_percent: 0,
          chunk_count: null,
          path_status: { vector: "pending", graph: "pending", wiki: "pending" },
        }),
      ],
    });
    expect(screen.getByText("解析中")).toBeTruthy();
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it("surfaces the error text (graph degraded marker rides the error field)", () => {
    renderPanel({ documents: [doc({ status: "ready", error: "图谱抽取降级：失败率 45%" })] });
    expect(screen.getByText(/图谱抽取降级/)).toBeTruthy();
  });

  it("opens the chunk drawer when a row is clicked", () => {
    const { onOpenChunks } = renderPanel();
    fireEvent.click(screen.getByText("产品手册.pdf"));
    expect(onOpenChunks).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-1" }));
  });

  it("deletes a document after the cascade-warning confirm", async () => {
    const { onDeleteDocument } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText(/将级联清理该文档的切片、向量与图谱贡献/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDeleteDocument).toHaveBeenCalledWith("doc-1");
  });

  it("offers retry only on failed documents", () => {
    renderPanel();
    // ready document: delete is present, retry is not
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("invokes onRetryDocument for a failed document", () => {
    const handlers = renderPanel({ documents: [doc({ status: "failed", error: "boom", chunk_count: null })] });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(handlers.onRetryDocument).toHaveBeenCalledWith("doc-1");
  });
});

describe("DocumentPanel stats row and upload", () => {
  it("aggregates the bottom stats row client-side", () => {
    renderPanel({
      documents: [
        doc({ id: "a", status: "ready", size_bytes: 1024, chunk_count: 5 }),
        doc({ id: "b", status: "indexing", size_bytes: 1024, chunk_count: null }),
        doc({ id: "c", status: "failed", size_bytes: 2048, chunk_count: null }),
      ],
    });
    const statsRow = screen.getByTestId("document-stats-row");
    expect(statsRow.textContent).toContain("3");
    expect(statsRow.textContent).toContain("4.0 KB");
    expect(statsRow.textContent).toContain("5");
  });

  it("uploads via drag-drop on the panel", () => {
    const { onUpload } = renderPanel();
    const zone = screen.getByTestId("document-dropzone");
    const file = new File(["x"], "拖入.md", { type: "text/markdown" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith([file]);
  });

  it("intercepts unsupported dropped files before upload (Task 6)", () => {
    const { onUpload } = renderPanel();
    const zone = screen.getByTestId("document-dropzone");
    const good = new File(["y"], "拖入.txt");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "evil.exe"), good] } });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("evil.exe"));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith([good]);
  });

  it("shows a drop-hint overlay while a file is dragged over the panel", () => {
    renderPanel();
    const zone = screen.getByTestId("document-dropzone");
    expect(screen.queryByTestId("document-drop-overlay")).toBeNull();
    fireEvent.dragOver(zone);
    expect(screen.getByTestId("document-drop-overlay")).toBeTruthy();
    expect(screen.getByText("释放以上传到当前知识库")).toBeTruthy();
    fireEvent.dragLeave(zone);
    expect(screen.queryByTestId("document-drop-overlay")).toBeNull();
  });

  it("shows the empty-state copy when the kb has no documents", () => {
    renderPanel({ documents: [] });
    expect(screen.getByText(/还没有文档/)).toBeTruthy();
  });
});

describe("DocumentPanel per-path status hover (P3, spec 2026-08-11 §5)", () => {
  it("wraps the status badge with a tooltip trigger when path_status is present", () => {
    renderPanel({
      documents: [
        doc({
          status: "indexing",
          progress_percent: 87,
          chunk_count: null,
          path_status: { vector: "done", graph: "indexing", wiki: "pending" },
        }),
      ],
    });
    expect(screen.getByTestId("path-status-trigger")).toBeTruthy();
  });

  it("renders no tooltip trigger for legacy rows whose path_status is null", () => {
    renderPanel();
    expect(screen.queryByTestId("path-status-trigger")).toBeNull();
  });

  it("assembles the three-path breakdown, combining the graph-sourced percent", () => {
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <PathStatusBreakdown
          doc={doc({
            status: "indexing",
            progress_percent: 87,
            path_status: { vector: "done", graph: "indexing", wiki: "pending" },
          })}
        />
      </I18nContext.Provider>,
    );
    const breakdown = screen.getByTestId("path-status-breakdown");
    expect(breakdown.textContent).toContain("向量");
    expect(breakdown.textContent).toContain("已完成");
    // 悬停文案组合展示百分比（progress_percent 与图谱路同源）
    expect(breakdown.textContent).toContain("图谱");
    expect(breakdown.textContent).toContain("索引中 87%");
    // wiki 为库级镜像——文案挑明库级语义
    expect(breakdown.textContent).toContain("百科（库级）");
    expect(breakdown.textContent).toContain("待处理");
  });

  it("renders degraded / failed / wiki-ready states verbatim", () => {
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <PathStatusBreakdown
          doc={doc({
            status: "ready",
            path_status: { vector: "failed", graph: "degraded", wiki: "ready" },
          })}
        />
      </I18nContext.Provider>,
    );
    const breakdown = screen.getByTestId("path-status-breakdown");
    expect(breakdown.textContent).toContain("失败");
    expect(breakdown.textContent).toContain("部分降级");
    expect(breakdown.textContent).toContain("已生成");
    // 就绪态不组合百分比
    expect(breakdown.textContent).not.toContain("%");
  });

  it("pathStatusLines returns null for legacy rows (no hover)", () => {
    expect(pathStatusLines(doc({ path_status: null }))).toBeNull();
  });
});

describe("DocumentPanel toolbar", () => {
  const docs = [
    doc({ id: "a", name: "产品手册.pdf", size_bytes: 4096, created_at: "2026-08-08T10:00:00Z" }),
    doc({ id: "b", name: "Roadmap.md", size_bytes: 1024, created_at: "2026-08-09T09:00:00Z" }),
    doc({ id: "c", name: "研发规范.docx", size_bytes: 2048, created_at: "2026-08-09T10:00:00Z" }),
  ];

  function rowNames(): string[] {
    // First column is the selection checkbox; the name is the second cell.
    return [...document.querySelectorAll("tbody tr td:nth-child(2)")].map(
      (cell) => cell.textContent ?? "",
    );
  }

  it("filters rows by the search box and offers a clear button", () => {
    renderPanel({ documents: docs });
    const search = screen.getByPlaceholderText("搜索文档…");
    fireEvent.change(search, { target: { value: "roadmap" } });
    expect(rowNames()).toEqual(["Roadmap.md"]);
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(rowNames()).toHaveLength(3);
  });

  it("shows the no-match hint when the filter matches nothing", () => {
    renderPanel({ documents: docs });
    fireEvent.change(screen.getByPlaceholderText("搜索文档…"), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的文档")).toBeTruthy();
  });

  it("sorts by upload time descending by default and re-sorts via the dropdown", async () => {
    renderPanel({ documents: docs });
    expect(rowNames()).toEqual(["研发规范.docx", "Roadmap.md", "产品手册.pdf"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "排序方式" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "大小" }));
    expect(rowNames()).toEqual(["产品手册.pdf", "研发规范.docx", "Roadmap.md"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "排序方式" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "升序" }));
    expect(rowNames()).toEqual(["Roadmap.md", "研发规范.docx", "产品手册.pdf"]);
  });
});
