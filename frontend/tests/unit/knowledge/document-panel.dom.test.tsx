/**
 * Middle column of the knowledge page (spec §5.2/§3.6): kb header actions,
 * the document table (名称/上传者/大小/切片数/状态/时间/操作), the aggregated
 * bottom stats row, drag-drop upload, cascade-warning delete confirms, and
 * failed-doc retry. Presentational — data/mutations arrive via props.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DocumentPanel } from "@/components/workspace/knowledge/document-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeBase, KnowledgeDocument } from "@/core/knowledge/types";

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
    created_at: "2026-08-09T10:00:00Z",
    ...partial,
  };
}

function renderPanel(props?: Partial<Parameters<typeof DocumentPanel>[0]>) {
  const handlers = {
    onUpload: rs.fn(),
    onGenerateWiki: rs.fn(),
    onRenameKb: rs.fn().mockResolvedValue(undefined),
    onDeleteKb: rs.fn().mockResolvedValue(undefined),
    onDeleteDocument: rs.fn().mockResolvedValue(undefined),
    onRetryDocument: rs.fn(),
    onOpenChunks: rs.fn(),
  };
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <DocumentPanel kb={KB} documents={[doc({})]} {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return handlers;
}

afterEach(cleanup);

describe("DocumentPanel header", () => {
  it("renders kb name, type tag and the overflow menu trigger", () => {
    renderPanel();
    expect(screen.getByText("产品资料")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "上传文档" })).toBeNull();
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
  });

  it("uploads via the overflow menu item", async () => {
    const clickSpy = rs
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    try {
      renderPanel();
      fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
      fireEvent.click(await screen.findByText("上传文档"));
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("invokes onGenerateWiki from the overflow menu", async () => {
    const { onGenerateWiki } = renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("生成百科"));
    expect(onGenerateWiki).toHaveBeenCalled();
  });

  it("renames the kb through the settings menu", async () => {
    const { onRenameKb } = renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("重命名知识库"));
    // The dialog opens deferred (runAfterMenuClose) once the menu's dismissal
    // layer has torn down, so wait for it asynchronously.
    fireEvent.change(await screen.findByDisplayValue("产品资料"), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameKb).toHaveBeenCalledWith("新名称");
  });

  it("deletes the kb only after the cascade-warning confirm", async () => {
    const { onDeleteKb } = renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "设置" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("删除知识库"));
    expect(await screen.findByText(/将同时删除全部文档、切片、向量、图谱与百科条目/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDeleteKb).toHaveBeenCalled();
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

  it("uploads via the file input", () => {
    const { onUpload } = renderPanel();
    const input = screen.getByTestId("document-upload-input");
    const file = new File(["x"], "新手册.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith([file]);
  });

  it("uploads via drag-drop on the panel", () => {
    const { onUpload } = renderPanel();
    const zone = screen.getByTestId("document-dropzone");
    const file = new File(["x"], "拖入.md", { type: "text/markdown" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith([file]);
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
