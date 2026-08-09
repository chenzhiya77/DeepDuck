/**
 * Citation cards under an assistant answer (spec §4.6/§3.6): the answer's
 * retrieval sources render as a numbered "参考来源" list; clicking a source
 * expands the shared ChunkCard with the original chunk text.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { KbCitationSources } from "@/components/workspace/knowledge/kb-citation-sources";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeCitation } from "@/core/knowledge/types";

const SOURCES: KnowledgeCitation[] = [
  {
    chunk_id: "doc-1#0000",
    doc_name: "产品手册.pdf",
    page: 3,
    heading_path: ["第一章"],
    text: "知识库系统将非结构化文档转化为可检索的知识资产。",
    score: 0.87,
  },
  {
    chunk_id: "doc-2#0003",
    doc_name: "架构设计.md",
    page: null,
    heading_path: [],
    text: "Gateway 通过 Nginx 反向代理对外提供统一入口。",
    score: 0.76,
  },
];

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

describe("KbCitationSources", () => {
  it("renders the sources label with one numbered entry per source", () => {
    renderWithI18n(<KbCitationSources sources={SOURCES} />);
    expect(screen.getByText("参考来源")).toBeTruthy();
    expect(screen.getByText("[1]")).toBeTruthy();
    expect(screen.getByText("[2]")).toBeTruthy();
    expect(screen.getByText("产品手册.pdf")).toBeTruthy();
    expect(screen.getByText("架构设计.md")).toBeTruthy();
    expect(screen.getByText(/第 3 页/)).toBeTruthy();
  });

  it("renders nothing when there are no sources", () => {
    const { container } = renderWithI18n(<KbCitationSources sources={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("expands the shared chunk card with the original text on click", () => {
    renderWithI18n(<KbCitationSources sources={SOURCES} />);
    expect(screen.queryByText(SOURCES[0]!.text)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /产品手册\.pdf/ }));
    expect(screen.getByText(SOURCES[0]!.text)).toBeTruthy();
    // The other source stays collapsed.
    expect(screen.queryByText(SOURCES[1]!.text)).toBeNull();
  });

  it("collapses the expanded chunk when the same source is clicked again", () => {
    renderWithI18n(<KbCitationSources sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /产品手册\.pdf/ }));
    expect(screen.getByText(SOURCES[0]!.text)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /产品手册\.pdf/ }));
    expect(screen.queryByText(SOURCES[0]!.text)).toBeNull();
  });

  it("switches the expanded chunk when another source is clicked", () => {
    renderWithI18n(<KbCitationSources sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /产品手册\.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /架构设计\.md/ }));
    expect(screen.queryByText(SOURCES[0]!.text)).toBeNull();
    expect(screen.getByText(SOURCES[1]!.text)).toBeTruthy();
  });
});
