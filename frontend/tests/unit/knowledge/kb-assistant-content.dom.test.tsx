/**
 * KbAssistantContent through the REAL markdown pipeline (no MarkdownContent
 * mock) — the citation-ux suite mocks it, so the plugin's in-pipeline
 * behaviour needs this coverage (born from the phase-2 integration fix:
 * the render prop must reach MessageListItem's MarkdownContent).
 */
import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { KbAssistantContent } from "@/components/workspace/knowledge/kb-assistant-content";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeCitation } from "@/core/knowledge/types";

const CHUNK: KnowledgeCitation = {
  chunk_id: "c1",
  doc_name: "手册.pdf",
  page: 3,
  heading_path: ["第一章"],
  text: "切片原文",
  score: 0.9,
  source_type: "chunk",
};

function renderContent(isLoading: boolean, content = "依据文档 [1] 可知") {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <KbAssistantContent
        content={content}
        isLoading={isLoading}
        messageId="m1"
        sources={[CHUNK]}
        threadId="thread-1"
        artifactPaths={[]}
      />
    </I18nContext.Provider>,
  );
}

afterEach(cleanup);

describe("KbAssistantContent real pipeline", () => {
  it("renders [1] as a superscript citation mark after streaming ends", () => {
    renderContent(false);
    expect(screen.getByRole("button", { name: "引用 1：手册.pdf" })).toBeTruthy();
  });

  it("keeps [1] as plain text while streaming (deferred rendering)", () => {
    renderContent(true);
    expect(screen.queryByRole("button", { name: "引用 1：手册.pdf" })).toBeNull();
    expect(screen.getByText(/\[1\]/)).toBeTruthy();
  });

  it("renders the model's citation_no as the remapped display number through the real pipeline", () => {
    // The model wrote backend citation_no [9]; after cross-path merge the
    // chunk sits at sorted position 2 — the visible mark is 2, not 9.
    const wiki: KnowledgeCitation = {
      chunk_id: "e1",
      doc_name: "DeerFlow",
      page: null,
      heading_path: [],
      text: "条目全文",
      score: 0.7,
      source_type: "wiki",
      citation_nos: [1],
    };
    const chunk: KnowledgeCitation = { ...CHUNK, citation_nos: [5, 9] };
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <KbAssistantContent
          content="依据文档 [9] 可知"
          isLoading={false}
          messageId="m1"
          sources={[wiki, chunk]}
          threadId="thread-1"
          artifactPaths={[]}
        />
      </I18nContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "引用 2：手册.pdf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /引用 9/ })).toBeNull();
  });
});

// 2026-10-11 修复：面板的引用渲染器曾只带 `sup` override，把默认路径上的
// img/a 解析整体丢掉——助手回答里的 markdown 图按原始 `/mnt/...` src 渲染，
// 浏览器按页面源拼接 → 404 → streamdown 占位「Image not available」。
describe("KbAssistantContent artifact resolution", () => {
  it("resolves a /mnt/ markdown image through the artifacts API", () => {
    renderContent(false, "看图：\n\n![红圆](/mnt/user-data/uploads/circle.png)");
    const img = screen.getByRole("img", { name: "红圆" });
    expect(img.getAttribute("src")).toBe(
      "/api/threads/thread-1/artifacts/mnt/user-data/uploads/circle.png",
    );
  });

  it("resolves a relative image against the thread's artifact paths", () => {
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <KbAssistantContent
          content="![图](images/a.png)"
          isLoading={false}
          messageId="m1"
          sources={[]}
          threadId="thread-1"
          artifactPaths={["/mnt/user-data/outputs/images/a.png"]}
        />
      </I18nContext.Provider>,
    );
    const img = screen.getByRole("img", { name: "图" });
    expect(img.getAttribute("src")).toBe(
      "/api/threads/thread-1/artifacts/mnt/user-data/outputs/images/a.png",
    );
  });

  it("resolves /mnt/ artifact links", () => {
    renderContent(false, "[报告](/mnt/user-data/outputs/report.md)");
    const link = screen.getByRole("link", { name: "报告" });
    expect(link.getAttribute("href")).toBe(
      "/api/threads/thread-1/artifacts/mnt/user-data/outputs/report.md",
    );
  });
});
