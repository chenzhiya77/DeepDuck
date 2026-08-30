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
  useSynthesisStatus: rs.fn(),
  useTriggerSynthesis: rs.fn(),
  useAcceptSynthesisCandidate: rs.fn(),
  useRejectSynthesisCandidate: rs.fn(),
  useDocuments: rs.fn(),
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
  expected_paths: ["wiki"],
  relevant_chunk_ids: [],
  relevant_entities: [],
  reference_answer: null,
};

const Q_ANCHORED: EvalQuestion = {
  id: "q_22222222",
  query: "锚定了三个切片的考题",
  category: "fact",
  expected_paths: ["vector"],
  relevant_chunk_ids: [CHUNK_A, CHUNK_B, "c".repeat(32) + "#0003"],
  relevant_entities: ["退休", "养老金"],
  reference_answer: "参考答案全文。",
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
  // 合成状态默认空暂存（审核区块不渲染，既有用例不受影响）。
  hooksMock.useSynthesisStatus.mockReturnValue({
    data: { in_progress: false, candidates: [], generated_at: null, doc_id: null, dropped: 0 },
    isLoading: false,
  });
  hooksMock.useDocuments.mockReturnValue({ data: [], isLoading: false });
  hooksMock.useTriggerSynthesis.mockReturnValue({ mutateAsync: rs.fn(), isPending: false });
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

  it("空题库渲染引导文案（双入口：召回面板存题 + 文档合成）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.getByText("题库为空——在召回测试面板勾选正确切片可一键存为考题")).toBeTruthy();
    // 双入口第二句（2026-08-28 §7）：合成造题引导。
    expect(screen.getByText("或从文档合成候选题，审核后采纳入题库")).toBeTruthy();
  });

  it("受控 synthesisOpen 渲染合成 dialog（入口已并入 eval-tab 常驻工具栏）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" synthesisOpen />);
    expect(screen.getByText(zhCN.knowledge.eval.synthesize.dialogTitle)).toBeTruthy();
  });

  it("不自渲染造题入口按钮（工具行与底部虚线按钮均移除）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    expect(screen.queryByRole("button", { name: /生成考题/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /添加考题/ })).toBeNull();
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

  it("路径列渲染 expected_paths 全量 Badge（多路即多枚）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_MULTI, Q_ANCHORED]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    const row = screen.getByText("多路预期的考题").closest("tr")!;
    expect(within(row as HTMLElement).getByText("vector")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("graph")).toBeTruthy();
    const singleRow = screen.getByText("锚定了三个切片的考题").closest("tr")!;
    expect(within(singleRow as HTMLElement).getAllByText("vector")).toHaveLength(1);
  });

  it("行点击打开详情 drawer 并携带该题", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    fireEvent.click(screen.getByText("锚定了三个切片的考题"));
    expect(screen.getByTestId("eval-question-drawer-mock")).toBeTruthy();
    expect(drawerMock.props?.question).toEqual(Q_ANCHORED);
    expect(drawerMock.props?.open).toBe(true);
  });

  it("表格样式对齐文档列表（表头 text-xs 降高 + 行高收窄；行内复现按钮移除）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    const { container } = renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    // 表头：默认 h-10 是松夸根源，降成文档列表同款 text-xs + 自然高。
    const head = container.querySelector("th")!;
    expect(head.className).toContain("text-xs");
    expect(head.className).toContain("h-auto");
    // 行：单元格与文档列表同节奏（px-2 py-2，表头 32 / 行 36）；原默认 p-2 保留纵向，
    // 松垮根源是表头 h-10 与行尾大图标按钮，不是单元格内边距。
    const firstCell = container.querySelector("tbody td")!;
    expect(firstCell.className).toContain("py-2");
    // 通栏对齐（文档列表同款）：表格左右拉满，首列左缘/末列右缘 pl/pr-4 找齐工具栏内容边距，
    // 表头分界线与常驻工具栏下沿左右端点对齐。
    const heads = container.querySelectorAll("th");
    expect(heads[0]!.className).toContain("pl-4");
    expect(heads[heads.length - 1]!.className).toContain("pr-4");
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells[0]!.className).toContain("pl-4");
    expect(cells[cells.length - 1]!.className).toContain("pr-4");
    // 行内 ↗ 复现按钮移除（占栏宽），复现入口留在详情 drawer。
    expect(screen.queryByRole("button", { name: "在召回测试面板复现" })).toBeNull();
    // 🗑 删除保留。
    expect(screen.getByRole("button", { name: "删除考题" })).toBeTruthy();
  });

  it("审核区块隐藏时包裹容器不占位（表头上方不浮出 8px 间隙）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    // 缺省 mock 即空暂存：review 组件返回 null，包裹 div 为 :empty。
    const { container } = renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" />);
    const reviewWrap = container.querySelector("div.px-4")!;
    expect(reviewWrap.className).toContain("[&:empty]:hidden");
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

  it("受控 addOpen 渲染添加 dialog（入口已并入 eval-tab 常驻工具栏）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank addOpen enabled kbId="kb-1" />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("EvalQuestionBank 搜索过滤（2026-08-30，搜索框在 eval-tab 常驻工具栏）", () => {
  it("searchQuery 按题目文本不区分大小写包含过滤", () => {
    hooksMock.useEvalQuestions.mockReturnValue({
      isLoading: false,
      error: null,
      ...questionsState([Q_UNANCHORED, Q_ANCHORED, Q_MULTI]),
    });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" searchQuery="多路" />);
    expect(screen.getByText("多路预期的考题")).toBeTruthy();
    expect(screen.queryByText("未锚定的考题")).toBeNull();
    expect(screen.queryByText("锚定了三个切片的考题")).toBeNull();
  });

  it("无匹配时渲染无匹配态（区别于空库引导）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({
      isLoading: false,
      error: null,
      ...questionsState([Q_ANCHORED]),
    });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" searchQuery="不存在的词" />);
    expect(screen.getByText("无匹配的题目，换个关键词试试")).toBeTruthy();
    expect(screen.queryByText("锚定了三个切片的考题")).toBeNull();
  });

  it("空库时即使带过滤词仍渲染空库引导（不进入无匹配态）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<EvalQuestionBank enabled kbId="kb-1" searchQuery="任意词" />);
    expect(screen.getByText("题库为空——在召回测试面板勾选正确切片可一键存为考题")).toBeTruthy();
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

  it("空 query 时提交禁用；填后可提交（默认仅勾 vector，分类默认首项）", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(false);
    // 分类仍是 Select 默认首项；预期路径改 Checkbox 组，默认仅勾 vector。
    expect(screen.getByRole("combobox", { name: "分类" }).textContent).toBe("事实");
    expect(screen.getByRole("checkbox", { name: "vector" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "graph" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "wiki" }).getAttribute("aria-checked")).toBe("false");
  });

  it("全不勾路径时提交禁用（至少一路）", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "vector" }));
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(true);
  });

  it("勾两项提交体为双路集合，且不含旧单数键与锚定键", async () => {
    const mutateAsync = renderDialog();
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "分类" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "关系" }));
    // 默认已勾 vector；再勾 graph → 双路
    fireEvent.click(screen.getByRole("checkbox", { name: "graph" }));

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ query: "新考题", category: "relation", expected_paths: ["vector", "graph"] });
    expect(body).not.toHaveProperty("expected_path");
    expect(body).not.toHaveProperty("relevant_chunk_ids");
    expect(body).not.toHaveProperty("relevant_entities");
  });

  it("不改选择时按默认值（单路集合）提交并发成功 toast", async () => {
    const mutateAsync = renderDialog();
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "新考题" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ category: "fact", expected_paths: ["vector"] });
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已添加")).toBe(true);
    });
  });
});
