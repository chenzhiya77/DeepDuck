/**
 * Manual knowledge cards panel (Phase-3 Batch-1 P6, spec §8): collapsible
 * section under the wiki tab — card list (title + summary + 混入搜索 badge),
 * create/edit dialog with validation, per-row include toggle, delete behind a
 * confirm dialog. Manual cards never auto-update and stay isolated from the
 * AI-generated wiki entries.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import { ManualCardPanel } from "@/components/workspace/knowledge/manual-card-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import {
  useCreateManualCard,
  useDeleteManualCard,
  useManualCard,
  useManualCards,
  useUpdateManualCard,
} from "@/core/knowledge/hooks";
import type { ManualCardDetail, ManualCardsPage } from "@/core/knowledge/types";

const CARDS_PAGE: ManualCardsPage = {
  items: [
    {
      id: "card-1",
      title: "发布禁令",
      summary: "周五下午不发布",
      tags: ["ops"],
      include_in_wiki_search: true,
      created_at: "2026-08-15T10:00:00Z",
      updated_at: "2026-08-15T10:00:00Z",
    },
    {
      id: "card-2",
      title: "回滚流程",
      summary: "先切流量再回滚",
      tags: [],
      include_in_wiki_search: false,
      created_at: "2026-08-15T09:00:00Z",
      updated_at: "2026-08-15T09:00:00Z",
    },
  ],
  total: 2,
  offset: 0,
  limit: 50,
};

const CARD_DETAIL: ManualCardDetail = {
  id: "card-1",
  kb_id: "kb-1",
  owner_id: "user-1",
  title: "发布禁令",
  content: "周五下午不发布，紧急修复走审批",
  tags: ["ops"],
  include_in_wiki_search: true,
  created_at: "2026-08-15T10:00:00Z",
  updated_at: "2026-08-15T10:00:00Z",
};

function setupMocks({ cardsPage = CARDS_PAGE, isLoading = false, cardDetail = null as ManualCardDetail | null } = {}) {
  const createCard = { mutateAsync: rs.fn().mockResolvedValue({}), isPending: false };
  const updateCard = { mutateAsync: rs.fn().mockResolvedValue({}), isPending: false };
  const deleteCard = { mutateAsync: rs.fn().mockResolvedValue(undefined), isPending: false };
  rs.mocked(useManualCards).mockReturnValue({ data: cardsPage, isLoading } as never);
  rs.mocked(useManualCard).mockReturnValue({ data: cardDetail } as never);
  rs.mocked(useCreateManualCard).mockReturnValue(createCard as never);
  rs.mocked(useUpdateManualCard).mockReturnValue(updateCard as never);
  rs.mocked(useDeleteManualCard).mockReturnValue(deleteCard as never);
  return { createCard, updateCard, deleteCard };
}

function renderPanel(props?: { onOpenCard?: (cardId: string) => void }) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <ManualCardPanel kbId="kb-1" {...props} />
    </I18nContext.Provider>,
  );
}

/** Collapsed by default — expand through the section header. */
function renderExpanded(props?: { onOpenCard?: (cardId: string) => void }) {
  const utils = renderPanel(props);
  fireEvent.click(screen.getByTestId("manual-cards-toggle"));
  return utils;
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("ManualCardPanel", () => {
  it("is collapsed by default and expands via the section header", () => {
    setupMocks();
    renderPanel();

    expect(screen.getByText("我的知识卡片")).toBeTruthy();
    expect(screen.queryByText("发布禁令")).toBeNull();

    fireEvent.click(screen.getByTestId("manual-cards-toggle"));
    expect(screen.getByText("发布禁令")).toBeTruthy();
    expect(screen.getByText("回滚流程")).toBeTruthy();
  });

  it("reveals row actions on hover like the AI rows (no permanent right gutter)", () => {
    setupMocks();
    renderExpanded();

    // 行通栏：不再为常驻操作区预留 pr-28
    const row = screen.getByTestId("manual-card-row-card-1");
    expect(row.className).not.toContain("pr-28");
    // Switch + 编辑 + 删除 整体悬停浮现（与 wiki 行一致）
    const switchEl = screen.getAllByRole("switch")[0]!;
    const actionBar = switchEl.closest("div.absolute");
    expect(actionBar?.className).toContain("opacity-0");
    expect(actionBar?.className).toContain("group-hover:opacity-100");
  });

  it("places 新建卡片 before the select-all checkbox so the checkbox aligns with the AI section", () => {
    setupMocks();
    renderExpanded();

    const newCardButton = screen.getByRole("button", { name: "新建卡片" });
    const selectAll = screen.getByRole("checkbox", { name: "全选" });
    // 新建在左、全选贴右边缘（与 AI 条目区 header 中的全选位置对齐）
    expect(
      newCardButton.compareDocumentPosition(selectAll) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the 混入搜索 badge only on opted-in cards", () => {
    setupMocks();
    renderExpanded();

    expect(screen.getByText("混入搜索")).toBeTruthy(); // card-1 only
    const switches = screen.getAllByRole("switch");
    expect((switches[0]!).getAttribute("aria-checked")).toBe("true");
    expect((switches[1]!).getAttribute("aria-checked")).toBe("false");
  });

  it("renders the empty state when expanded with no cards", () => {
    setupMocks({ cardsPage: { items: [], total: 0, offset: 0, limit: 50 } });
    renderExpanded();

    expect(screen.getByText(/还没有知识卡片/)).toBeTruthy();
  });

  it("creates a card from the dialog with validation", async () => {
    const { createCard } = setupMocks();
    renderExpanded();

    fireEvent.click(screen.getByRole("button", { name: "新建卡片" }));
    const saveButton = screen.getByRole("button", { name: "保存" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "  新卡片  " } });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true); // content still blank
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "正文内容" } });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(createCard.mutateAsync).toHaveBeenCalledWith({
        title: "新卡片",
        content: "正文内容",
        tags: [],
        include_in_wiki_search: false,
      });
    });
  });

  it("toggles a row's include switch", async () => {
    const { updateCard } = setupMocks();
    renderExpanded();

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]!); // card-2: off → on

    await waitFor(() => {
      expect(updateCard.mutateAsync).toHaveBeenCalledWith({
        cardId: "card-2",
        body: { include_in_wiki_search: true },
      });
    });
  });

  it("opens the editor prefilled for an existing card and saves changes", async () => {
    const { updateCard } = setupMocks({ cardDetail: CARD_DETAIL });
    renderExpanded();

    fireEvent.click(screen.getAllByRole("button", { name: "编辑卡片" })[0]!);
    const contentField = await screen.findByLabelText("内容");
    expect((contentField as HTMLTextAreaElement).value).toBe("周五下午不发布，紧急修复走审批");
    const titleField = await screen.findByLabelText("标题");
    expect((titleField as HTMLInputElement).value).toBe("发布禁令");

    fireEvent.change(contentField, { target: { value: "周五全天不发布" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateCard.mutateAsync).toHaveBeenCalledWith({
        cardId: "card-1",
        body: { title: "发布禁令", content: "周五全天不发布", tags: ["ops"], include_in_wiki_search: true },
      });
    });
  });

  it("deletes a card behind a confirm dialog", async () => {
    const { deleteCard } = setupMocks();
    renderExpanded();

    fireEvent.click(screen.getAllByRole("button", { name: "删除卡片" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(deleteCard.mutateAsync).toHaveBeenCalledWith("card-1");
    });
  });

  it("opens the card detail drawer on row click, mirroring wiki entries (P6 fix)", () => {
    setupMocks();
    const onOpenCard = rs.fn();
    renderExpanded({ onOpenCard });

    fireEvent.click(screen.getByTestId("manual-card-row-card-1"));
    expect(onOpenCard).toHaveBeenCalledWith("card-1");
    fireEvent.click(screen.getByTestId("manual-card-row-card-2"));
    expect(onOpenCard).toHaveBeenCalledWith("card-2");
  });

  it("row actions (edit / delete / include toggle) never trigger the drawer", () => {
    setupMocks();
    const onOpenCard = rs.fn();
    renderExpanded({ onOpenCard });

    // 删除按钮最后点——确认 Dialog 弹出后背景 aria-hidden，switch 会查不到。
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑卡片" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "删除卡片" })[0]!);

    expect(onOpenCard).not.toHaveBeenCalled();
  });
});
