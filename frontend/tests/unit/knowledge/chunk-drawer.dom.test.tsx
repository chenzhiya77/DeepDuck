/**
 * Shared read-only chunk display (spec §3.6 切片可视化 / §4.6 引用展开):
 * the same card renders drawer chunks (full metadata) and citation-expanded
 * chunks (doc name + text). The drawer paginates through the chunks endpoint.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("@/core/knowledge/hooks", () => ({
  useDocumentChunks: rs.fn(),
}));

import { ChunkCard } from "@/components/workspace/knowledge/chunk-card";
import { ChunkDrawer } from "@/components/workspace/knowledge/chunk-drawer";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { useDocumentChunks } from "@/core/knowledge/hooks";
import type { KnowledgeChunk, KnowledgeDocument } from "@/core/knowledge/types";

const CHUNK: KnowledgeChunk = {
  chunk_id: "doc-1#0000",
  doc_id: "doc-1",
  kb_id: "kb-1",
  chunk_index: 0,
  text: "知识库系统将非结构化文档转化为可检索的知识资产。",
  heading_path: ["第一章", "1.1 目标"],
  page: 3,
  token_count: 512,
  entities: ["DeerFlow", "Gateway"],
  extract_status: "done",
};

const DOC: KnowledgeDocument = {
  id: "doc-1",
  kb_id: "kb-1",
  uploader_id: "user-1",
  name: "产品手册.pdf",
  size_bytes: 2048,
  storage_path: "p",
  status: "ready",
  progress_percent: 100,
  chunk_count: 2,
  error: null,
  path_status: null,
  content_hash: null,
  created_at: "2026-08-09T10:00:00Z",
};

function renderWithI18n(node: React.ReactNode) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {node}
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("ChunkCard", () => {
  it("renders text with heading path, page, tokens, and entities", () => {
    renderWithI18n(<ChunkCard text={CHUNK.text} headingPath={CHUNK.heading_path} page={CHUNK.page} tokenCount={CHUNK.token_count} entities={CHUNK.entities} />);
    expect(screen.getByText(CHUNK.text)).toBeTruthy();
    expect(screen.getByText(/第一章/)).toBeTruthy();
    expect(screen.getByText(/1\.1 目标/)).toBeTruthy();
    expect(screen.getByText(/3/)).toBeTruthy();
    expect(screen.getByText(/512/)).toBeTruthy();
    expect(screen.getByText("DeerFlow")).toBeTruthy();
    expect(screen.getByText("Gateway")).toBeTruthy();
  });

  it("renders the citation form (doc name + text) without drawer-only metadata", () => {
    renderWithI18n(<ChunkCard docName="产品手册.pdf" text={CHUNK.text} page={2} />);
    expect(screen.getByText(/产品手册\.pdf/)).toBeTruthy();
    expect(screen.getByText(CHUNK.text)).toBeTruthy();
  });

  it("lets the entity badge row wrap so many long entities never overflow the card", () => {
    // Production repro: six long entity badges (知识库 RAG 一期 / 三路索引 /
    // 三栏工作台 / …) rendered on ONE nowrap flex line and spilled past the
    // card boundary; the 实体: label got squeezed into a vertical column.
    const many = ["知识库 RAG 一期", "三路索引", "三栏工作台", "多租户共享与权限", "召回测试与评估面板", "图谱可视化探索"];
    renderWithI18n(<ChunkCard text={CHUNK.text} entities={many} />);
    const label = screen.getByText(/实体/);
    expect(label.className).toContain("shrink-0");
    expect(label.parentElement!.className).toContain("flex-wrap");
  });
});

describe("ChunkDrawer", () => {
  it("loads and renders the first chunk page when opened", async () => {
    rs.mocked(useDocumentChunks).mockReturnValue({
      data: { items: [CHUNK], total: 1, offset: 0, limit: 50 },
      isLoading: false,
    } as never);

    renderWithI18n(<ChunkDrawer kbId="kb-1" doc={DOC} open onOpenChange={() => undefined} />);

    expect(await screen.findByText(CHUNK.text)).toBeTruthy();
    expect(rs.mocked(useDocumentChunks).mock.calls[0]?.slice(0, 2)).toEqual(["kb-1", "doc-1"]);
    // no second page → no load-more button
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("paginates through 加载更多", async () => {
    rs.mocked(useDocumentChunks).mockReturnValue({
      data: { items: [CHUNK], total: 2, offset: 0, limit: 1 },
      isLoading: false,
    } as never);

    renderWithI18n(<ChunkDrawer kbId="kb-1" doc={DOC} open onOpenChange={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    const calls = rs.mocked(useDocumentChunks).mock.calls;
    // growing-limit pagination: same offset, larger limit on the next request
    expect(calls.at(-1)![2]).toBe(calls[0]![2]);
    expect(calls.at(-1)![3]).toBeGreaterThan(calls[0]![3]);
  });

  it("shows the empty-state copy when the document has no chunks", async () => {
    rs.mocked(useDocumentChunks).mockReturnValue({
      data: { items: [], total: 0, offset: 0, limit: 50 },
      isLoading: false,
    } as never);

    renderWithI18n(<ChunkDrawer kbId="kb-1" doc={DOC} open onOpenChange={() => undefined} />);

    expect(await screen.findByText("该文档还没有切片")).toBeTruthy();
  });
});
