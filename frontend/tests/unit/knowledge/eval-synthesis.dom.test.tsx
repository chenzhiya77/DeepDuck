/**
 * 合成造题前端契约测试（2026-08-28 spec §6，plan Task 11）：
 * - 触发 dialog：文档下拉 + 数量选择；未选文档禁用；提交体 {doc_id, count}；
 *   enqueued → success toast 并关闭，already_running → info toast 不关闭；
 * - 审核面板：暂存空且非运行中不渲染；候选卡片字段全量；采纳/忽略/全部忽略
 *   分别驱动 accept/reject mutation；in_progress 显示「生成中…」。
 *
 * 轮询门控（refetchInterval）已在 hooks.dom.test（Task 8）钉死，此处不重复。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";

const hooksMock = rs.hoisted(() => ({
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

import { EvalSynthesisDialog } from "@/components/workspace/knowledge/eval-synthesis-dialog";
import { EvalSynthesisReview } from "@/components/workspace/knowledge/eval-synthesis-review";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeDocument, SynthesisCandidate, SynthesisStatus } from "@/core/knowledge/types";

const DOC = "a".repeat(32);

const READY_DOC: KnowledgeDocument = {
  id: DOC,
  kb_id: "kb-1",
  uploader_id: "user-1",
  name: "Java 并发.md",
  size_bytes: 100,
  storage_path: "p",
  status: "ready",
  progress_percent: 100,
  chunk_count: 12,
  error: null,
  path_status: null,
  content_hash: null,
  created_at: "2026-08-28T09:00:00Z",
};

const INDEXING_DOC: KnowledgeDocument = { ...READY_DOC, id: "b".repeat(32), name: "索引中.pdf", status: "indexing", chunk_count: 0 };

const CAND_1: SynthesisCandidate = {
  candidate_id: "c_aaaa1111",
  query: "String 有什么特点？",
  category: "fact",
  expected_paths: ["vector"],
  relevant_chunk_ids: [`${DOC}#0001`],
  relevant_entities: [],
  reference_answer: "String 是不可变类型。",
  doc_id: DOC,
  generated_at: "2026-08-28T10:00:00+00:00",
};

const CAND_2: SynthesisCandidate = {
  candidate_id: "c_bbbb2222",
  query: "两个可变字符串类有什么关系？",
  category: "relation",
  expected_paths: ["vector", "graph"],
  relevant_chunk_ids: [`${DOC}#0002`, `${DOC}#0003`],
  relevant_entities: [],
  reference_answer: null,
  doc_id: DOC,
  generated_at: "2026-08-28T10:00:00+00:00",
};

const STATUS_WITH_CANDIDATES: SynthesisStatus = {
  in_progress: false,
  candidates: [CAND_1, CAND_2],
  generated_at: "2026-08-28T10:00:00+00:00",
  doc_id: DOC,
  dropped: 2,
};

const STATUS_EMPTY: SynthesisStatus = { in_progress: false, candidates: [], generated_at: null, doc_id: null, dropped: 0 };

function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      {ui}
    </I18nContext.Provider>,
  );
}

beforeEach(() => {
  hooksMock.useSynthesisStatus.mockReset();
  hooksMock.useTriggerSynthesis.mockReset();
  hooksMock.useAcceptSynthesisCandidate.mockReset();
  hooksMock.useRejectSynthesisCandidate.mockReset();
  hooksMock.useDocuments.mockReset();
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("EvalSynthesisDialog（触发）", () => {
  function renderDialog(onOpenChange = rs.fn()) {
    const mutateAsync = rs.fn().mockResolvedValue({ status: "enqueued" });
    hooksMock.useDocuments.mockReturnValue({ data: [READY_DOC, INDEXING_DOC], isLoading: false });
    hooksMock.useTriggerSynthesis.mockReturnValue({ mutateAsync, isPending: false });
    renderWithI18n(<EvalSynthesisDialog kbId="kb-1" onOpenChange={onOpenChange} open />);
    return { mutateAsync, onOpenChange };
  }

  it("文档未选时提交禁用；下拉只列已索引文档", async () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "生成" }).hasAttribute("disabled")).toBe(true);

    // 索引中文档不进选项（后端无切片必 409——前端预过滤减错）
    fireEvent.keyDown(screen.getByRole("combobox", { name: "来源文档" }), { key: "ArrowDown" });
    expect(await screen.findByRole("option", { name: "Java 并发.md" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "索引中.pdf" })).toBeNull();
  });

  it("提交携带 {doc_id, count}；enqueued → success toast 并关闭", async () => {
    const { mutateAsync, onOpenChange } = renderDialog();

    fireEvent.keyDown(screen.getByRole("combobox", { name: "来源文档" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Java 并发.md" }));
    expect(screen.getByRole("button", { name: "生成" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ doc_id: DOC, count: 5 }));
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.length).toBeGreaterThan(0);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("already_running → info toast 且不关闭 dialog", async () => {
    const { mutateAsync, onOpenChange } = renderDialog();
    mutateAsync.mockResolvedValue({ status: "already_running" });

    fireEvent.keyDown(screen.getByRole("combobox", { name: "来源文档" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Java 并发.md" }));
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => {
      expect(rs.mocked(toast.info).mock.calls.length).toBeGreaterThan(0);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("EvalSynthesisReview（审核面板）", () => {
  function renderReview(status: SynthesisStatus) {
    const acceptAsync = rs.fn().mockResolvedValue({ id: "q_new12345", query: CAND_1.query });
    const rejectAsync = rs.fn().mockResolvedValue(undefined);
    hooksMock.useSynthesisStatus.mockReturnValue({ data: status, isLoading: false });
    hooksMock.useAcceptSynthesisCandidate.mockReturnValue({ mutateAsync: acceptAsync, isPending: false });
    hooksMock.useRejectSynthesisCandidate.mockReturnValue({ mutateAsync: rejectAsync, isPending: false });
    renderWithI18n(<EvalSynthesisReview enabled kbId="kb-1" />);
    return { acceptAsync, rejectAsync };
  }

  it("暂存空且非运行中 → 不渲染（表格常态）", () => {
    renderReview(STATUS_EMPTY);
    expect(screen.queryByText(zhCN.knowledge.eval.synthesize.reviewTitle)).toBeNull();
  });

  it("候选卡片字段全量渲染 + 元信息行含丢弃数", () => {
    renderReview(STATUS_WITH_CANDIDATES);
    expect(screen.getByText(zhCN.knowledge.eval.synthesize.reviewTitle)).toBeTruthy();
    expect(screen.getByText(CAND_1.query)).toBeTruthy();
    expect(screen.getByText(CAND_2.query)).toBeTruthy();
    // category 显示名走 i18n；多路 Badge 全量
    expect(screen.getByText("事实")).toBeTruthy();
    expect(screen.getByText("关系")).toBeTruthy();
    expect(screen.getAllByText("vector").length).toBe(2);
    expect(screen.getByText("graph")).toBeTruthy();
    // 锚定切片数（1 切片 / 2 切片）与参考答案
    expect(screen.getByText("1 切片")).toBeTruthy();
    expect(screen.getByText("2 切片")).toBeTruthy();
    expect(screen.getByText("String 是不可变类型。")).toBeTruthy();
    // 元信息行：丢弃数进文案
    expect(screen.getByText("锚定越界或字段违例被丢弃 2 条")).toBeTruthy();
  });

  it("采纳 → accept mutation 携带 candidate_id 并发成功 toast", async () => {
    const { acceptAsync } = renderReview(STATUS_WITH_CANDIDATES);
    const acceptButtons = screen.getAllByRole("button", { name: "采纳" });
    fireEvent.click(acceptButtons[0]!);
    await waitFor(() => expect(acceptAsync).toHaveBeenCalledWith("c_aaaa1111"));
    await waitFor(() => {
      expect(rs.mocked(toast.success).mock.calls.some(([m]) => m === "考题已添加")).toBe(true);
    });
  });

  it("忽略 → reject mutation 携带 candidate_id", async () => {
    const { rejectAsync } = renderReview(STATUS_WITH_CANDIDATES);
    const rejectButtons = screen.getAllByRole("button", { name: "忽略" });
    fireEvent.click(rejectButtons[1]!);
    await waitFor(() => expect(rejectAsync).toHaveBeenCalledWith("c_bbbb2222"));
  });

  it("全部忽略 → 逐条 reject 每个候选", async () => {
    const { rejectAsync } = renderReview(STATUS_WITH_CANDIDATES);
    fireEvent.click(screen.getByRole("button", { name: "全部忽略" }));
    await waitFor(() => expect(rejectAsync).toHaveBeenCalledTimes(2));
    expect(rejectAsync).toHaveBeenNthCalledWith(1, "c_aaaa1111");
    expect(rejectAsync).toHaveBeenNthCalledWith(2, "c_bbbb2222");
  });

  it("in_progress → 生成中文案", () => {
    renderReview({ ...STATUS_WITH_CANDIDATES, in_progress: true, candidates: [] });
    expect(screen.getByText("生成中…")).toBeTruthy();
  });
});
