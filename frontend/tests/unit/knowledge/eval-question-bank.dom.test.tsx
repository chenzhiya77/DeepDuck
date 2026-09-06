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
import { useState, type ComponentProps, type ReactElement } from "react";
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
  useTriggerEvalRun: rs.fn(),
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

/** 受控包装（2026-09-02 批量运行栏退役）：选题集上提 eval-tab，
    测试用有状态包装模拟上游；initialSelected 直接预置选中集。 */
type BankHarnessProps = Omit<ComponentProps<typeof EvalQuestionBank>, "selectedIds" | "onSelectedIdsChange" | "onTrigger"> & {
  initialSelected?: string[];
  onTrigger?: ComponentProps<typeof EvalQuestionBank>["onTrigger"];
};
function BankHarness({ initialSelected, onTrigger, ...rest }: BankHarnessProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set(initialSelected ?? []));
  return (
    <EvalQuestionBank
      {...rest}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      onTrigger={onTrigger ?? (() => undefined)}
    />
  );
}

beforeEach(() => {
  drawerMock.props = undefined;
  hooksMock.useEvalQuestions.mockReset();
  hooksMock.useDeleteEvalQuestion.mockReset();
  hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync: rs.fn().mockResolvedValue(undefined), isPending: false });
  // 合成状态默认空暂存（审核区块不渲染，既有用例不受影响）。
  hooksMock.useSynthesisStatus.mockReturnValue({
    data: { in_progress: false, candidates: [], generated_at: null, doc_ids: [], dropped: 0 },
    isLoading: false,
  });
  hooksMock.useDocuments.mockReturnValue({ data: [], isLoading: false });
  hooksMock.useTriggerSynthesis.mockReturnValue({ mutateAsync: rs.fn(), isPending: false });
  hooksMock.useTriggerEvalRun.mockReset();
  hooksMock.useTriggerEvalRun.mockReturnValue({ mutate: rs.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
});

describe("EvalQuestionBank 表格", () => {
  it("loading 渲染加载提示", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: true, error: null, data: undefined });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("错误渲染加载失败提示", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: new Error("boom"), data: undefined });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    expect(screen.getByText("评测数据加载失败")).toBeTruthy();
  });

  it("空题库渲染引导文案（双入口：召回面板存题 + 文档合成）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    expect(screen.getByText("题库为空——在召回测试面板勾选正确切片可一键存为考题")).toBeTruthy();
    // 双入口第二句（2026-08-28 §7）：合成造题引导。
    expect(screen.getByText("或从文档合成候选题，审核后采纳入题库")).toBeTruthy();
  });

  it("受控 synthesisOpen 渲染合成 dialog（入口已并入 eval-tab 常驻工具栏）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" synthesisOpen />);
    expect(screen.getByText(zhCN.knowledge.eval.synthesize.dialogTitle)).toBeTruthy();
  });

  it("不自渲染造题入口按钮（工具行与底部虚线按钮均移除）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    expect(screen.queryByRole("button", { name: /生成考题/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /添加考题/ })).toBeNull();
  });

  it("行渲染与锚定列推导（切片 · 实体 / 未锚定 muted）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_UNANCHORED, Q_ANCHORED]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
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
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    const row = screen.getByText("多路预期的考题").closest("tr")!;
    expect(within(row as HTMLElement).getByText("vector")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("graph")).toBeTruthy();
    const singleRow = screen.getByText("锚定了三个切片的考题").closest("tr")!;
    expect(within(singleRow as HTMLElement).getAllByText("vector")).toHaveLength(1);
  });

  it("行点击打开详情 drawer 并携带该题", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    fireEvent.click(screen.getByText("锚定了三个切片的考题"));
    expect(screen.getByTestId("eval-question-drawer-mock")).toBeTruthy();
    expect(drawerMock.props?.question).toEqual(Q_ANCHORED);
    expect(drawerMock.props?.open).toBe(true);
  });

  it("表格样式对齐文档列表（表头 text-xs 降高 + 行高收窄；行内复现按钮移除）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    const { container } = renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    // 表头：默认 h-10 是松夸根源，降成文档列表同款 text-xs；2026-09-02 起单元格
    // 钉死 h-9（36px）与文档表头对齐——自然高（复选框 + 内边距 ≈ 36.44）会撑破 tr 钉高。
    // th[0] 是选题复选框列（2026-09-01 B 方案），断言打在首个文本列上。
    const head = container.querySelectorAll("th")[1]!;
    expect(head.className).toContain("text-xs");
    expect(head.className).toContain("h-9");
    // 表头字色钉 muted（与文档表头对齐，2026-09-02）：ui/table 默认 text-foreground
    // 会压过 tr 的继承，不钉到单元格层「表头浅灰、内容深色」的层级语言不生效。
    expect(head.className).toContain("text-muted-foreground");
    // 行：单元格与文档列表同节奏；行间无分割线（2026-09-02）——ui/table 默认
    // border-b 与文档表「无框表、结构线只留表头发丝线」决策不一致（文档行早已
    // 去掉），border-0 收掉题目间那条线，两表数据行同为 px-2 py-2 无框行。
    const firstRow = container.querySelector("tbody tr")!;
    expect(firstRow.className).toContain("border-0");
    const firstCell = container.querySelector("tbody td")!;
    expect(firstCell.className).toContain("py-2");
    // 通栏对齐（文档列表同款）：表格左右拉满；首列是复选框瞬态控件，
    // px-2 与文档表头位置一致（跨 tab 一致性优先于找齐工具栏边距，2026-09-02），
    // 末列 pr-4 找齐工具栏右缘。
    const heads = container.querySelectorAll("th");
    expect(heads[0]!.className).toContain("px-2");
    expect(heads[0]!.className).not.toContain("pl-4");
    expect(heads[heads.length - 1]!.className).toContain("pr-4");
    // 吸顶表头（2026-09-02）：表头单元格 sticky，发丝线用 inset 阴影随粘性移动（
    // border-collapse 下 tr 边框会随滚动丢失）；表格外壳不可是独立滚动容器（
    // overflow-x-auto 会接管纵向滚动、破坏 sticky，横滚交给内容区）。
    expect(heads[0]!.className).toContain("sticky");
    expect(heads[0]!.className).toContain("top-0");
    expect(heads[0]!.className).toContain("bg-background");
    expect(heads[0]!.className).toContain("shadow-[inset_0_-1px_0_var(--border)]");
    expect(container.querySelector("thead")!.className).toContain("[&_tr]:border-0");
    expect(container.querySelector("[data-slot='table-container']")!.className).not.toContain("overflow-x-auto");
    // 表头行高与文档表头对齐：h-9 钉高 36px（2026-09-02）。
    expect(container.querySelector("thead tr")!.className).toContain("h-9");
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells[0]!.className).toContain("px-2");
    expect(cells[0]!.className).not.toContain("pl-4");
    expect(cells[cells.length - 1]!.className).toContain("pr-4");
    // 行复选框悬浮显形（同文档表，2026-09-02）：默认隐形，悬停/勾选/任一选中才显形。
    const rowCheckbox = cells[0]!.querySelector("[data-slot='checkbox']")!;
    expect(rowCheckbox.className).toContain("opacity-0");
    expect(rowCheckbox.className).toContain("group-hover:opacity-100");
    expect(rowCheckbox.className).toContain("data-[state=checked]:opacity-100");
    expect(container.querySelector("tbody tr")!.className).toContain("group");
    // 行内 ↗ 复现按钮移除（占栏宽），复现入口留在详情 drawer。
    expect(screen.queryByRole("button", { name: "在召回测试面板复现" })).toBeNull();
    // 末列改悬浮三点（2026-09-02）：size-8 删除按钮（32px，撑出 48px 行高）换成
    // 文档 tab 同款 size-6（24px）三点菜单，行高落到 40px 与文档表对齐；删除进
    // 三点菜单（行级「删除考题」）。静止态隐形，hover/选中/菜单开才显形。
    const more = screen.getByRole("button", { name: "更多操作" });
    expect(more.className).toContain("size-6");
    const moreWrap = screen.getByTestId("bank-row-more");
    expect(moreWrap.className).toContain("opacity-0");
    expect(moreWrap.className).toContain("group-hover:opacity-100");
  });

  it("审核区块隐藏时包裹容器不占位（表头上方不浮出 8px 间隙）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    // 缺省 mock 即空暂存：review 组件返回 null，包裹 div 为 :empty。
    const { container } = renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    const reviewWrap = container.querySelector("div.px-4")!;
    expect(reviewWrap.className).toContain("[&:empty]:hidden");
  });

  it("🗑 三点菜单删除打开确认框：取消不调 mutation", async () => {
    const mutateAsync = rs.fn().mockResolvedValue(undefined);
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    // 删除收进末列三点菜单（2026-09-02）：jsdom 中 Radix DropdownMenu 须用
    // keyDown ArrowDown 展开（不响应 click），再点菜单里的「删除考题」。
    fireEvent.keyDown(screen.getByRole("button", { name: "更多操作" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除考题" }));

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
    renderWithI18n(<BankHarness enabled kbId="kb-1" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "更多操作" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除考题" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(Q_ANCHORED.id));
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已删除")).toBe(true);
    });
  });

  it("末列三点菜单提供快速/完整评测（行级，携该题 id）", async () => {
    const onTrigger = rs.fn();
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([Q_ANCHORED]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" onTrigger={onTrigger} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "更多操作" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "完整评测" }));
    const payload = onTrigger.mock.calls[0]?.[0] as { layers?: string; question_ids?: string[] };
    expect(payload.layers).toBe("l1_l2");
    expect(payload.question_ids).toEqual([Q_ANCHORED.id]);
  });

  it("受控 addOpen 渲染添加 dialog（入口已并入 eval-tab 常驻工具栏）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<BankHarness addOpen enabled kbId="kb-1" />);
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
    renderWithI18n(<BankHarness enabled kbId="kb-1" searchQuery="多路" />);
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
    renderWithI18n(<BankHarness enabled kbId="kb-1" searchQuery="不存在的词" />);
    expect(screen.getByText("无匹配的题目，换个关键词试试")).toBeTruthy();
    expect(screen.queryByText("锚定了三个切片的考题")).toBeNull();
  });

  it("空库时即使带过滤词仍渲染空库引导（不进入无匹配态）", () => {
    hooksMock.useEvalQuestions.mockReturnValue({ isLoading: false, error: null, ...questionsState([]) });
    renderWithI18n(<BankHarness enabled kbId="kb-1" searchQuery="任意词" />);
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

// ── 题库勾选 + 批量运行（2026-09-01 B 方案 Task 5）────────────────
// 选题与档位两个正交维度：复选框列选题（行点击开 drawer 的既有行为保留），
// 批量栏双档触发携 question_ids；触发成功清空选择。

describe("EvalQuestionBank 选题与右键菜单（2026-09-02 批量运行栏退役）", () => {
  // 触发已上收 eval-tab（2026-09-06 验收缺口修复）：bank 只委托 onTrigger，不再自持
  // mutation；选择清空也由上层 handleTrigger 负责，本层断言仅到"委托携正确 payload"。
  let onTrigger: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    onTrigger = rs.fn();
    hooksMock.useEvalQuestions.mockReturnValue(questionsState([Q_UNANCHORED, Q_ANCHORED, Q_MULTI]));
  });
  afterEach(() => cleanup());

  it("批量运行栏退役：勾选后不再出现插入式条（抖动源），行复选框勾选不触发抽屉", () => {
    renderWithI18n(<BankHarness kbId="kb-1" />);
    const box = screen.getByRole("checkbox", { name: `选择「${Q_ANCHORED.query}」` });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    // 旧批量运行栏的任何痕迹都不应出现。
    expect(screen.queryByTestId("eval-bulk-run-bar")).toBeNull();
    expect(screen.queryByText(/已选 \d+ 题/)).toBeNull();
    // 勾选不开详情 drawer（行点击才开）
    expect(screen.queryByTestId("eval-question-drawer-mock")).toBeNull();
  });

  it("表头全选切换全部可见题", () => {
    renderWithI18n(<BankHarness kbId="kb-1" />);
    const selectAll = screen.getByRole("checkbox", { name: "全选" });
    fireEvent.click(selectAll);
    for (const question of [Q_UNANCHORED, Q_ANCHORED, Q_MULTI]) {
      expect(screen.getByRole("checkbox", { name: `选择「${question.query}」` }).getAttribute("aria-checked")).toBe("true");
    }
    fireEvent.click(selectAll);
    expect(screen.getByRole("checkbox", { name: `选择「${Q_ANCHORED.query}」` }).getAttribute("aria-checked")).toBe("false");
  });

  it("右键未选中行只选中该行，单选菜单提供快速评测（只跑该题）", () => {
    renderWithI18n(<BankHarness kbId="kb-1" onTrigger={onTrigger} />);
    fireEvent.contextMenu(screen.getByText(Q_ANCHORED.query));
    // 右键即选中（文件管理器惯例）。菜单打开时背景 aria-hidden，
    // getByRole 查不到——用 getByLabelText（不受可访问性树过滤）。
    expect(screen.getByLabelText(`选择「${Q_ANCHORED.query}」`).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "快速评测" }));
    const payload = onTrigger.mock.calls[0]?.[0] as { layers?: string; question_ids?: string[] };
    expect(payload.layers).toBe("l1");
    expect(payload.question_ids).toEqual([Q_ANCHORED.id]);
  });

  it("单选右键菜单提供完整评测（l1_l2 只跑该题）", () => {
    renderWithI18n(<BankHarness kbId="kb-1" onTrigger={onTrigger} />);
    fireEvent.contextMenu(screen.getByText(Q_ANCHORED.query));
    fireEvent.click(screen.getByRole("menuitem", { name: "完整评测" }));
    const payload = onTrigger.mock.calls[0]?.[0] as { layers?: string; question_ids?: string[] };
    expect(payload.layers).toBe("l1_l2");
    expect(payload.question_ids).toEqual([Q_ANCHORED.id]);
  });

  it("多选右键菜单结构：已选标签 → 快速评测 → 完整评测 → 取消选择 → 分隔线 → 删除所选", () => {
    renderWithI18n(<BankHarness initialSelected={[Q_ANCHORED.id, Q_MULTI.id]} kbId="kb-1" onTrigger={onTrigger} />);
    fireEvent.contextMenu(screen.getByText(Q_ANCHORED.query));
    expect(screen.getByText("已选 2 项")).toBeTruthy();
    const names = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(names).toEqual(["快速评测", "完整评测", "取消选择", "删除所选"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    // 快速评测携选中集委托上层触发（清空选择由 eval-tab 负责）。
    fireEvent.click(screen.getByRole("menuitem", { name: "快速评测" }));
    const payload = onTrigger.mock.calls[0]?.[0] as { layers?: string; question_ids?: string[] };
    expect(payload.layers).toBe("l1");
    expect([...(payload.question_ids ?? [])].sort()).toEqual([Q_ANCHORED.id, Q_MULTI.id].sort());
  });

  it("右键菜单取消选择带 X 图标且能清选择", async () => {
    renderWithI18n(<BankHarness initialSelected={[Q_ANCHORED.id]} kbId="kb-1" />);
    fireEvent.contextMenu(screen.getByText(Q_ANCHORED.query));
    const cancel = screen.getByRole("menuitem", { name: "取消选择" });
    expect(cancel.querySelector("svg")).toBeTruthy();
    fireEvent.click(cancel);
    await waitFor(() => {
      const box = document.querySelector(`[aria-label="选择「${Q_ANCHORED.query}」"]`);
      expect(box?.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("右键删除所选：批量确认框展示计数，确认后逐题删除并修选择集", async () => {
    const mutateAsync = rs.fn().mockResolvedValue(undefined);
    hooksMock.useDeleteEvalQuestion.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<BankHarness initialSelected={[Q_ANCHORED.id, Q_MULTI.id]} kbId="kb-1" />);
    fireEvent.contextMenu(screen.getByText(Q_ANCHORED.query));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除所选" }));

    const dialog = await screen.findByRole("dialog");
    // 批量态展示已选计数而非单题 query。
    expect(dialog.textContent).toContain("已选 2 项");
    expect(dialog.textContent).not.toContain(Q_ANCHORED.query);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenCalledWith(Q_ANCHORED.id);
    expect(mutateAsync).toHaveBeenCalledWith(Q_MULTI.id);
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已删除")).toBe(true);
    });
    // 删完后选择集清空。
    expect(screen.getByRole("checkbox", { name: `选择「${Q_UNANCHORED.query}」` }).getAttribute("aria-checked")).toBe("false");
  });
});
