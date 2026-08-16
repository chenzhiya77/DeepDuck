/**
 * Wiki tab container (split-section layout): one unified search box above the
 * AI entries section and the manual-cards section. Typing one query filters
 * both sections (and force-expands/fetches the collapsed cards section); the
 * clear button restores both lists.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("@/core/knowledge/hooks", () => ({
  useManualCards: rs.fn(),
  useManualCard: rs.fn(),
  useCreateManualCard: rs.fn(),
  useUpdateManualCard: rs.fn(),
  useDeleteManualCard: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn() },
}));

import { WikiTab } from "@/components/workspace/knowledge/wiki-tab";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import {
  useCreateManualCard,
  useDeleteManualCard,
  useManualCard,
  useManualCards,
  useUpdateManualCard,
} from "@/core/knowledge/hooks";
import type { WikiEntrySummary } from "@/core/knowledge/types";

const ENTRIES: WikiEntrySummary[] = [
  { id: "e1", title: "DeerFlow", summary: "超级代理系统", status: "ready", updated_at: "2026-08-10T08:00:00Z" },
  { id: "e2", title: "Gateway", summary: "网关负责统一鉴权", status: "ready", updated_at: "2026-08-10T09:00:00Z" },
];

function setupMocks() {
  rs.mocked(useManualCards).mockReturnValue({
    data: {
      items: [
        {
          id: "card-1",
          title: "发布禁令",
          summary: "周五下午不发布",
          tags: [],
          include_in_wiki_search: false,
          created_at: "2026-08-15T10:00:00Z",
          updated_at: "2026-08-15T10:00:00Z",
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    },
    isLoading: false,
  } as never);
  rs.mocked(useManualCard).mockReturnValue({ data: null } as never);
  rs.mocked(useCreateManualCard).mockReturnValue({ mutateAsync: rs.fn(), isPending: false } as never);
  rs.mocked(useUpdateManualCard).mockReturnValue({ mutateAsync: rs.fn(), isPending: false } as never);
  rs.mocked(useDeleteManualCard).mockReturnValue({ mutateAsync: rs.fn(), isPending: false } as never);
}

function renderTab() {
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <WikiTab
        entries={ENTRIES}
        kbId="kb-1"
        onDeleteEntry={rs.fn()}
        onOpenCard={rs.fn()}
        onOpenEntry={rs.fn()}
      />
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("WikiTab", () => {
  it("renders the unified search box above the two section headers", () => {
    setupMocks();
    renderTab();
    expect(screen.getByPlaceholderText("搜索百科条目与卡片…")).toBeTruthy();
    expect(screen.getByTestId("wiki-entries-toggle").textContent).toContain("AI 条目");
    expect(screen.getByTestId("manual-cards-toggle").textContent).toContain("我的知识卡片");
  });

  it("filters both sections with one query (cards force-expand to show matches)", () => {
    setupMocks();
    renderTab();
    // 初始：卡片区收起，AI 区展开
    expect(screen.queryByText("发布禁令")).toBeNull();
    expect(screen.getByText("DeerFlow")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索百科条目与卡片…"), { target: { value: "发布" } });
    // AI 区无匹配 → no-match 文案；卡片区强制展开并命中
    expect(screen.queryByText("DeerFlow")).toBeNull();
    expect(screen.getByText("没有匹配的条目")).toBeTruthy();
    expect(screen.getByText("发布禁令")).toBeTruthy();
  });

  it("restores both lists via the clear button", () => {
    setupMocks();
    renderTab();
    fireEvent.change(screen.getByPlaceholderText("搜索百科条目与卡片…"), { target: { value: "网关" } });
    expect(screen.queryByText("DeerFlow")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(screen.getByText("DeerFlow")).toBeTruthy();
    expect(screen.getByText("Gateway")).toBeTruthy();
  });
});
