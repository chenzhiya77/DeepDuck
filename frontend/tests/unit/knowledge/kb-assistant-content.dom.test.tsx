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

function renderContent(isLoading: boolean) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <KbAssistantContent content="依据文档 [1] 可知" isLoading={isLoading} messageId="m1" sources={[CHUNK]} />
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
});
