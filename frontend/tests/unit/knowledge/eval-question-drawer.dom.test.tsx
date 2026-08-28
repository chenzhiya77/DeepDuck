/**
 * 考题详情 drawer 契约测试（2026-08-27 spec §4.5，plan Task 6）：
 * 字段全量渲染（query 全文 / 分类 badge / 参考答案 / 锚定清单）、无参考答案
 * 降级「未填写」、复现与删除按钮回调。独立于 bank 测试文件——那边对本模块
 * 做了模块级 mock，无法在此渲染真实组件。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

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
    <EvalQuestionDrawer onDelete={onDelete} onOpenChange={() => undefined} onReproduce={onReproduce} open question={question} />,
  );
  return onDelete;
}

afterEach(() => {
  cleanup();
});

describe("EvalQuestionDrawer", () => {
  it("字段全量渲染：query 全文、分类 badge、参考答案、锚定清单", () => {
    renderDrawer(Q_ANCHORED);
    expect(screen.getByText(Q_ANCHORED.query)).toBeTruthy();
    expect(screen.getByText("事实")).toBeTruthy();
    expect(screen.getByText(CHUNK_A)).toBeTruthy();
    expect(screen.getByText(CHUNK_B)).toBeTruthy();
    expect(screen.getByText("退休")).toBeTruthy();
    expect(screen.getByText("参考答案全文。")).toBeTruthy();
  });

  it("无锚定与无参考答案的降级渲染", () => {
    renderDrawer(Q_UNANCHORED);
    expect(screen.getByText("未填写")).toBeTruthy();
    expect(screen.getByText("未锚定")).toBeTruthy();
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
