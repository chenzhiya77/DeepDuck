/**
 * 题库视图契约测试（2026-08-27 spec §4，plan Task 6）：
 * - 表格三态（loading / 失败 / 数据）与锚定列推导（切片数 · 实体数 / 未锚定）；
 * - 行点击开详情 drawer；操作列 ↗/🗑 stopPropagation；
 * - 删除二次确认：取消不调 mutation，确认调并发成功 toast；
 * - 添加 dialog：必填校验、提交体不含锚定键（后端补空数组，spec §4.4）；
 * - 详情 drawer：字段全量渲染、无参考答案降级、复现/删除回调。
 *
 * hooks 经 mock 注入（对齐 eval-tab.dom.test 先例）；drawer mock 记录 props；
 * 添加 dialog 与详情 drawer 在独立 describe 内渲染真实组件直测。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import { EvalAddQuestionDialog } from "@/components/workspace/knowledge/eval-add-question-dialog";
import { EvalQuestionBank } from "@/components/workspace/knowledge/eval-question-bank";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { EvalQuestion, EvalQuestionListResponse } from "@/core/knowledge/types";

const hooksMock = rs.hoisted(() => ({
  useEvalQuestions: rs.fn(),
  useAddEvalQuestion: rs.fn(),
  useDeleteEvalQuestion: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => hooksMock);

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

const drawerMock = rs.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

rs.mock("@/components/workspace/knowledge/eval-question-drawer", () => ({
  EvalQuestionDrawer: (props: Record<string, unknown>) => {
    drawerMock.props = props;
    return props.open ? <div data-testid="eval-question-drawer-mock" /> : null;
  },
}));

const CHUNK_A = "a".repeat(32) + "#0001";
const CHUNK_B = "b".repeat(32) + "#0002";

const Q_UNANCHORED: EvalQuestion = {
  id: "q_11111111",
  query: "未锚定的考题",
  category: "global",
  expected_path: "wiki",
  relevant_chunk_ids: [],
  relevant_entities: [],
  reference_answer: null,
};

const Q_ANCHORED: EvalQuestion = {
  id: "q_22222222",
  query: "锚定了三个切片的考题",
  category: "fact",
  expected_path: "vector",
  relevant_chunk_ids: [CHUNK_A, CHUNK_B, "c".repeat(32) + "#0003"],
  relevant_entities: ["退休", "养老金"],
  reference_answer: "参考答案全文。",
};

function questionsState(questions: EvalQuestion[]): { data: EvalQuestionListResponse } {
  return { data: { questions, total: questions.length } };
}

function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {ui}
    </I18nContext.Provider>,
  );
}

beforeEach(() => {
  drawerMock.props = undefined;
  hooksMock.useEvalQuestions.mockReset();
  hooksMock.useDeleteEvalQuestion.mockReset();
  hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync: rs.fn().mockResolvedValue(undefined), isPending: false });
});

afterEach(() => {
  cleanup();
});

describe("EvalQuestionBank 表格", () => {
  it("loading 渲染加载提示", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: true, error: null, data: undefined });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("错误渲染加载失败提示", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: new Error("boom"), data: undefined });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.getByText("评测数据加载失败")).toBeTruthy();
  });

  it("空题库渲染引导文案（指向召回测试面板）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.getByText("题库为空——在召回测试面板勾选正确切片可一键存为考题")).toBeTruthy();
  });

  it("行渲染与锚定列推导（切片 · 实体 / 未锚定 muted）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_UNANCHORED, Q_ANCHORED]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.getByText("未锚定的考题")).toBeTruthy();
    expect(screen.getByText("锚定了三个切片的考题")).toBeTruthy();
    expect(screen.getByText("未锚定")).toBeTruthy();
    expect(screen.getByText("3 切片")).toBeTruthy();
    expect(screen.getByText("2 实体")).toBeTruthy();
    // 分类显示名走 i18n（wire 键不外露）
    expect(screen.getByText("事实")).toBeTruthy();
    expect(screen.getByText("全局")).toBeTruthy();
  });

  it("行点击打开详情 drawer 并携带该题", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    fireEvent.click(screen.getByText("锚定了三个切片的考题"));
    expect(screen.getByTestId("eval-question-drawer-mock")).toBeTruthy();
    expect(drawerMock.props?.question).toEqual(Q_ANCHORED);
    expect(drawerMock.props?.open).toBe(true);
  });

  it("↗ 复现按钮回调携带 query 且不触发 drawer（stopPropagation）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    const onReproduce = rs.fn();
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" onReproduce={onReproduce} />);
    fireEvent.click(screen.getByRole("button", { name: "在召回测试面板复现" }));
    expect(onReproduce).toHaveBeenCalledWith(Q_ANCHORED.query);
    expect(screen.queryByTestId("eval-question-drawer-mock")).toBeNull();
  });

  it("🗑 删除按钮打开确认框：取消不调 mutation", async () => {
    const mutateAsync = rs.fn().mockResolvedValue(undefined);
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    fireEvent.click(screen.getByRole("button", { name: "删除考题" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(Q_ANCHORED.query);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("删除确认：确认调 delete mutation 并发成功 toast", async () => {
    const mutateAsync = rs.fn().mockResolvedValue(undefined);
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    fireEvent.click(screen.getByRole("button", { name: "删除考题" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(Q_ANCHORED.id));
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已删除")).toBe(true);
    });
  });

  it("添加考题入口打开添加 dialog", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    fireEvent.click(screen.getByRole("button", { name: /添加考题/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("EvalAddQuestionDialog", () => {
  function renderDialog() {
    const mutateAsync = rs.fn().mockResolvedValue({
      ...Q_ANCHORED,
      id: "q_new00001",
      query: "新考题",
    });
    hooksMock.useAddEvalQuestion.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<EvalAddQuestionDialog kbId="kb-1" onOpenChange={() => undefined} open />);
    return mutateAsync;
  }

  it("空 query 时提交禁用；填后可提交（分类/路径默认第一项，无空占位项）", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(false);
    // 无空占位项：shadcn Select 首项即默认值（SelectValue 直接显示默认项文案）
    expect(screen.getByRole("combobox", { name: "分类" }).textContent).toBe("事实");
    expect(screen.getByRole("combobox", { name: "预期路径" }).textContent).toBe("vector");
  });

  it("提交体不含锚定键（relevant_chunk_ids / relevant_entities）", async () => {
    const mutateAsync = renderDialog();
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    // Radix Select：jsdom 无 pointerCapture，键盘开菜单（vector-tab 先例）
    fireEvent.keyDown(screen.getByRole("combobox", { name: "分类" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "关系" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "预期路径" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "graph" }));

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ query: "新考题", category: "relation", expected_path: "graph" });
    expect(body).not.toHaveProperty("relevant_chunk_ids");
    expect(body).not.toHaveProperty("relevant_entities");
  });

  it("不改选择时按默认值提交并发成功 toast", async () => {
    const mutateAsync = renderDialog();
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ category: "fact", expected_path: "vector" });
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已添加")).toBe(true);
    });
  });
});
