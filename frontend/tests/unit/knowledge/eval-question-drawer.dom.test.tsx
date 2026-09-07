/**
 * 考题详情 drawer 契约测试（2026-08-27 spec §4.5，plan Task 6；2026-09-08
 * 裸奔退役重设计）：字段全量渲染（query 作 sticky 头标题 / 分类 badge /
 * 参考答案卡 / 依据按文档分组卡 + 切片计数徽章 / 实体卡）、无参考答案
 * 降级「未填写」、复现与删除按钮回调（钉底动作栏）。独立于 bank 测试
 * 文件——那边对本模块做了模块级 mock，无法在此渲染真实组件。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

const hooksMock = rs.hoisted(() => ({
  useDocuments: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => hooksMock);

import { EvalQuestionDrawer } from "@/components/workspace/knowledge/eval-question-drawer";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { EvalQuestion } from "@/core/knowledge/types";

const CHUNK_A = "a".repeat(32) + "#0001";
const CHUNK_B = "b".repeat(32) + "#0002";

const Q_ANCHORED: EvalQuestion = {
  id: "q_22222222",
  query: "锚定了三个切片的考题",
  category: "fact",
  expected_paths: ["vector"],
  relevant_chunk_ids: [CHUNK_A, CHUNK_B, "c".repeat(32) + "#0003"],
  relevant_entities: ["退休", "养老金"],
  reference_answer: "参考答案全文。",
};

const Q_UNANCHORED: EvalQuestion = {
  id: "q_11111111",
  query: "未锚定的考题",
  category: "global",
  expected_paths: ["wiki"],
  relevant_chunk_ids: [],
  relevant_entities: [],
  reference_answer: null,
};

const Q_MULTI: EvalQuestion = {
  id: "q_33333333",
  query: "多路预期的考题",
  category: "relation",
  expected_paths: ["vector", "graph"],
  relevant_chunk_ids: [CHUNK_A],
  relevant_entities: [],
  reference_answer: null,
};

function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {ui}
    </I18nContext.Provider>,
  );
}

function renderDrawer(question: EvalQuestion, onReproduce?: (q: string) => void) {
  const onDelete = rs.fn();
  renderWithI18n(
    <EvalQuestionDrawer kbId="kb-1" onDelete={onDelete} onOpenChange={() => undefined} onReproduce={onReproduce} open question={question} />,
  );
  return onDelete;
}

beforeEach(() => {
  hooksMock.useDocuments.mockReset();
  hooksMock.useDocuments.mockReturnValue({
    data: [
      { id: "a".repeat(32), name: "文档甲" },
      { id: "b".repeat(32), name: "文档乙" },
    ],
  });
});

afterEach(() => {
  cleanup();
});

describe("EvalQuestionDrawer", () => {
  it("字段全量渲染：query 全文、分类 badge、参考答案、依据按文档分组", () => {
    renderDrawer(Q_ANCHORED);
    expect(screen.getByText(Q_ANCHORED.query)).toBeTruthy();
    expect(screen.getByText("事实")).toBeTruthy();
    // 依据分组（2026-09-07）：组头=文档标题（取不到回退 doc_id 前 8 位），
    // 组内=chunk id 稳定序号；32 位 hex 裸 ID 不再出现。
    expect(screen.getByText("文档甲")).toBeTruthy();
    expect(screen.getByText("文档乙")).toBeTruthy();
    expect(screen.getByText("c".repeat(8))).toBeTruthy();
    expect(screen.getByText("#0001")).toBeTruthy();
    expect(screen.getByText("#0002")).toBeTruthy();
    expect(screen.getByText("#0003")).toBeTruthy();
    expect(screen.queryByText(CHUNK_A)).toBeNull();
    expect(screen.getByText("退休")).toBeTruthy();
    expect(screen.getByText("参考答案全文。")).toBeTruthy();
    // 容器化（2026-09-08 裸奔退役）：分区卡 caption 进卡内分组头，切片
    // 计数徽章 ml-auto（下钻层「N 切片」词汇，区别于行级「N 篇」）。
    expect(screen.getByText("参考答案")).toBeTruthy();
    expect(screen.getByText("参考文档")).toBeTruthy();
    expect(screen.getByText("实体")).toBeTruthy();
    expect(screen.getByText("3 切片")).toBeTruthy();
  });

  it("无锚定与无参考答案的降级渲染", () => {
    renderDrawer(Q_UNANCHORED);
    expect(screen.getByText("未填写")).toBeTruthy();
    expect(screen.getByText("未锚定")).toBeTruthy();
    // 实体卡仅有值显：空标注诚实缺省不摆空卡（也不显计数徽章）。
    expect(screen.queryByText("实体")).toBeNull();
  });

  it("多路预期渲染全量路径 Badge（与题库表格同口径）", () => {
    renderDrawer(Q_MULTI);
    expect(screen.getByText("vector")).toBeTruthy();
    expect(screen.getByText("graph")).toBeTruthy();
  });

  it("复现按钮回调携带 query；删除按钮回调携带该题", () => {
    const onReproduce = rs.fn();
    const onDelete = renderDrawer(Q_ANCHORED, onReproduce);
    fireEvent.click(screen.getByRole("button", { name: "在召回测试面板复现" }));
    expect(onReproduce).toHaveBeenCalledWith(Q_ANCHORED.query);
    fireEvent.click(screen.getByRole("button", { name: "删除考题" }));
    expect(onDelete).toHaveBeenCalledWith(Q_ANCHORED);
  });
});
