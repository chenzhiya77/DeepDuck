/**
 * Middle column of the knowledge page (spec §5.2/§3.6): kb header actions,
 * the document table (名称/上传者/状态/时间/大小/切片数/操作，2026-08-30 列序重排), the aggregated
 * bottom stats row, drag-drop upload, cascade-warning delete confirms, and
 * failed-doc retry. Presentational — data/mutations arrive via props.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("列序：文本列居左组、数值列聚右组；大小/切片数右对齐 + tabular-nums（2026-08-30）", () => {
    renderPanel();
    // 主流文件管理器（资源管理器/Drive）：文本列在左，大小/数量聚到右端。
    const headers = Array.from(screen.getAllByRole("columnheader"));
    expect(headers.map((h) => h.textContent?.trim())).toEqual(["", "名称", "上传者", "状态", "时间", "大小", "切片数", "操作"]);
    // 数值列表头右对齐，与数据同轴；单位（KB/MB）右缘成列。
    expect(headers[5]!.className).toContain("text-right");
    expect(headers[6]!.className).toContain("text-right");
    const sizeCell = screen.getByText("2.0 KB").closest("td")!;
    expect(sizeCell.className).toContain("text-right");
    expect(sizeCell.className).toContain("tabular-nums");
    expect(screen.getByText("12").closest("td")!.className).toContain("text-right");
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

  it("错误信息不常驻表格（产品化：失败只留状态，原因走 toast 通知，2026-08-30）", () => {
    renderPanel({ documents: [doc({ status: "failed", error: "retry limit reached (5 attempts)" })] });
    // 原始英文不外露；表格里只剩失败状态本身（红点+文案由状态列承载）
    expect(screen.queryByText(/retry limit/)).toBeNull();
    expect(screen.getByText("失败")).toBeTruthy();
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

  it("操作列全行统一：仅删除，无重试按钮，状态列不换行（2026-08-31）", () => {
    renderPanel({ documents: [doc({ status: "failed", error: "boom", chunk_count: null })] });
    // 失败行操作列也只有删除——行高形态与其他行一致；重试不占列宽。
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    // 状态单元格单行不换行（图 1 反馈：失败行被撑高换行）
    expect(screen.getByText("失败").closest("td")!.className).toContain("whitespace-nowrap");
  });

  it("悬停失败状态出卡片：友好原因 + 重试按钮（错误不常驻，重试不丢）", async () => {
    const handlers = renderPanel({
      documents: [doc({ status: "failed", error: "retry limit reached (5 attempts)", chunk_count: null })],
    });
    const trigger = screen.getByTestId("doc-retry-trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.pointerMove(trigger);
    const card = await screen.findByTestId("doc-retry-card");
    expect(card.textContent).toContain("解析服务多次重试仍失败");
    expect(card.textContent).not.toContain("retry limit");
    fireEvent.click(within(card).getByRole("button", { name: "重试" }));
    expect(handlers.onRetryDocument).toHaveBeenCalledWith("doc-1");
  });

  it("右键菜单为失败行提供重试兜底（Drive/OneDrive 主流兜底路径）", async () => {
    const handlers = renderPanel({ documents: [doc({ status: "failed", error: "boom", chunk_count: null })] });
    fireEvent.contextMenu(screen.getByText("产品手册.pdf"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /重试/ }));
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

// ── 状态与文件类型视觉（2026-08-30）────────────────────────
// 定案：文件名是第一扫描目标——状态改圆点+小字（Linear 风格，就绪退后、
// 失败唯一抢眼）；文件图标按类型形状+颜色区分（Drive/OneDrive 色系）。
describe("DocumentPanel 状态与类型图标", () => {
  function rowOf(name: string) {
    return screen.getByText(name).closest("tr")!;
  }

  it("就绪态：绿圆点 + muted 小字，不再是黑底徽章（视觉降级）", () => {
    renderPanel({ documents: [doc({ name: "手册.pdf" })] });
    const row = rowOf("手册.pdf");
    expect(row.querySelector("span.bg-emerald-500")).toBeTruthy();
    // 文本退为次要色，且不在 Badge 组件内（data-slot=badge）
    const label = row.querySelectorAll("span");
    const statusLabel = Array.from(label).find((span) => span.textContent === "就绪" && span.childElementCount === 0)!;
    expect(statusLabel.className).toContain("text-muted-foreground");
    expect(statusLabel.closest("[data-slot='badge']")).toBeNull();
  });

  it("进行中：琥珀圆点；失败：红点+红字（唯一突出的异常态）", () => {
    renderPanel({
      documents: [
        doc({ id: "d-idx", name: "索引中.pdf", status: "indexing", progress_percent: 40 }),
        doc({ id: "d-fail", name: "失败.pdf", status: "failed", error: "解析出错" }),
      ],
    });
    expect(rowOf("索引中.pdf").querySelector("span.bg-amber-500")).toBeTruthy();
    const failedRow = rowOf("失败.pdf");
    expect(failedRow.querySelector("span.bg-destructive")).toBeTruthy();
    const failedLabel = Array.from(failedRow.querySelectorAll("span")).find(
      (span) => span.textContent === "失败" && span.childElementCount === 0,
    )!;
    expect(failedLabel.className).toContain("text-destructive");
  });

  it("文件图标按类型形状+颜色区分（主流文件管理器色系），未知后缀回退", () => {
    renderPanel({
      documents: [
        doc({ id: "d1", name: "手册.pdf" }),
        doc({ id: "d2", name: "笔记.md" }),
        doc({ id: "d3", name: "截图.jpg" }),
        doc({ id: "d4", name: "数据.csv" }),
        doc({ id: "d5", name: "规范.docx" }),
        doc({ id: "d6", name: "演示.pptx" }),
        doc({ id: "d7", name: "未知.xyz" }),
      ],
    });
    const iconClassOf = (name: string) => rowOf(name).querySelector("td svg")?.getAttribute("class") ?? "";
    expect(iconClassOf("手册.pdf")).toContain("text-red-500");
    expect(iconClassOf("笔记.md")).toContain("text-sky-500");
    expect(iconClassOf("截图.jpg")).toContain("text-violet-500");
    expect(iconClassOf("数据.csv")).toContain("text-emerald-500");
    expect(iconClassOf("规范.docx")).toContain("text-blue-500");
    expect(iconClassOf("演示.pptx")).toContain("text-orange-500");
    // 未知后缀：通用图标 + 次要色，不假装有类型信息
    expect(iconClassOf("未知.xyz")).toContain("text-muted-foreground");
  });
});

// ── 失败通知面板接线（2026-08-31）────────────────────────────
// 定案（用户拍板）：错误通知退出全局 sonner toast（视口级，出 tab），
// 改为文档 tab 内右下角自绘面板；✕ 右侧、折叠/展开、总关/单关、不自动消失。
describe("DocumentPanel 失败通知面板接线", () => {
  it("有失败条目时渲染面板：文件名/原因两行，绝对定位在 tab 内右下角", () => {
    renderPanel({
      failures: [{ key: "doc-1", name: "户号.pptx", reason: "文件内容为空", retryable: true }],
      onDismissFailure: rs.fn(),
      onDismissAllFailures: rs.fn(),
    });
    const panel = screen.getByTestId("doc-failure-panel");
    expect(panel.className).toContain("absolute");
    expect(panel.className).toContain("bottom-3");
    expect(screen.getByText("户号.pptx")).toBeTruthy();
    expect(screen.getByText("文件内容为空")).toBeTruthy();
  });

  it("无失败条目时不渲染面板（默认 props 即可）", () => {
    renderPanel();
    expect(screen.queryByTestId("doc-failure-panel")).toBeNull();
  });

  it("面板关闭动作回流到页面层回调", () => {
    const onDismissFailure = rs.fn();
    const onDismissAllFailures = rs.fn();
    renderPanel({
      failures: [{ key: "doc-1", name: "户号.pptx", reason: "文件内容为空", retryable: true }],
      onDismissFailure,
      onDismissAllFailures,
    });
    fireEvent.click(screen.getByRole("button", { name: "全部关闭" }));
    expect(onDismissAllFailures).toHaveBeenCalledTimes(1);
    expect(onDismissFailure).not.toHaveBeenCalled();
  });

  it("面板内重试回流到 onRetryDocument（条目 key 即文档 id）", () => {
    const handlers = renderPanel({
      failures: [{ key: "doc-1", name: "户号.pptx", reason: "文件内容为空", retryable: true }],
      onDismissFailure: rs.fn(),
      onDismissAllFailures: rs.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(handlers.onRetryDocument).toHaveBeenCalledWith("doc-1");
  });
});
