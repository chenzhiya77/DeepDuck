/**
 * Recall-test tab (phase-2 batch-1, P1): query input + top_k + cost hint,
 * three per-path sections each annotated with its score_type and elapsed_ms.
 * Vector/graph hits expand into the shared ChunkCard; wiki hits open the
 * entry drawer via onOpenWikiEntry (overlay — never switches the middle tab).
 * Submit is disabled while a run is in flight; failures surface as a toast.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

rs.mock("@/core/knowledge/hooks", () => ({
  useRecallTest: rs.fn(),
  useAddEvalQuestion: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

import { RecallTestPanel } from "@/components/workspace/knowledge/recall-test-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { useAddEvalQuestion, useRecallTest } from "@/core/knowledge/hooks";
import type { RecallTestResponse } from "@/core/knowledge/types";

const RESULT: RecallTestResponse = {
  query: "Gateway 职责",
  paths: {
    vector: {
      hits: [
        { chunk_id: "c1", doc_name: "架构.md", text: "Gateway 负责会话管理。", heading_path: ["架构"], page: 1, score: 0.97, rank: 1 },
        // rerank 降级形态：score 为 null
        { chunk_id: "c2", doc_name: "架构.md", text: "切片二原文。", heading_path: [], page: 2, score: null, rank: 2 },
      ],
      message: "检索到 2 条相关切片。",
    },
    graph: {
      entities: [{ name: "Gateway", type: "组件", description: "会话管理入口" }],
      relations: [{ source: "DeerFlow", target: "Gateway", relation: "包含", description: "" }],
      evidence: [{ chunk_id: "c1", doc_name: "架构.md", text: "Gateway 负责会话管理。", heading_path: ["架构"], page: 1, score: 0.88 }],
      message: "命中 1 个实体。",
    },
    wiki: {
      hits: [{ entry_id: "e1", title: "DeerFlow", summary: "DeerFlow 是超级智能体系统……", score: 0.91, rank: 1 }],
      message: "命中 1 篇百科条目。",
    },
  },
  score_type: { vector: "qwen3-rerank relevance", graph: "embedding cosine（当次可比）", wiki: "embedding cosine" },
  elapsed_ms: { vector: 123, graph: 456, wiki: 78 },
};

function mockRecallTest(overrides?: { data?: RecallTestResponse | null; isPending?: boolean }) {
  const mutate = rs.fn();
  (useRecallTest as unknown as ReturnType<typeof rs.fn>).mockReturnValue({
    mutate,
    isPending: overrides?.isPending ?? false,
    data: overrides?.data ?? null,
  });
  return mutate;
}

function renderPanel(props?: Partial<Parameters<typeof RecallTestPanel>[0]>) {
  const handlers = { onOpenWikiEntry: rs.fn() };
  const utils = render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <RecallTestPanel kbId="kb-1" {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return { ...handlers, ...utils };
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("RecallTestPanel controls", () => {
  it("shows the empty guide and cost hint before the first run", () => {
    mockRecallTest();
    renderPanel();
    expect(screen.getByText("输入问题后开始检索，对比三路命中与得分")).toBeTruthy();
    expect(screen.getByText(/会产生检索调用成本/)).toBeTruthy();
  });

  it("submits the trimmed query with the default top_k=5", () => {
    const mutate = mockRecallTest();
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "  Gateway 职责  " } });
    fireEvent.click(screen.getByRole("button", { name: "开始检索" }));
    expect(mutate).toHaveBeenCalledWith({ query: "Gateway 职责", top_k: 5 }, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it("honours a custom top_k (clamped to 1–20)", () => {
    const mutate = mockRecallTest();
    renderPanel();
    fireEvent.change(screen.getByLabelText("每路条数"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "开始检索" }));
    expect(mutate).toHaveBeenCalledWith({ query: "x", top_k: 10 }, expect.anything());
  });

  it("disables submit for blank queries and while a run is in flight", () => {
    mockRecallTest({ isPending: true });
    renderPanel();
    expect(screen.getByRole("button", { name: "检索中…" })).toHaveProperty("disabled", true);
  });

  it("toasts on failure", () => {
    const mutate = mockRecallTest();
    mutate.mockImplementation((_vars: unknown, options: { onError: (error: Error) => void }) => {
      options.onError(new Error("boom"));
    });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "开始检索" }));
    expect(toast.error).toHaveBeenCalledWith("boom");
  });
});

describe("RecallTestPanel results", () => {
  it("renders the three path sections with score_type and elapsed_ms", () => {
    mockRecallTest({ data: RESULT });
    renderPanel();
    expect(screen.getByTestId("recall-path-vector").textContent).toContain("qwen3-rerank relevance");
    expect(screen.getByTestId("recall-path-vector").textContent).toContain("123");
    expect(screen.getByTestId("recall-path-graph").textContent).toContain("embedding cosine（当次可比）");
    expect(screen.getByTestId("recall-path-wiki").textContent).toContain("78");

    // vector hits: rank + score; the degraded hit renders a dash
    const first = screen.getByTestId("recall-vector-hit-c1");
    expect(first.textContent).toContain("#1");
    expect(first.textContent).toContain("0.970");
    expect(first.textContent).toContain("架构.md");
    expect(screen.getByTestId("recall-vector-hit-c2").textContent).toContain("—");

    // graph: entity chips, relation line, evidence score
    expect(screen.getByTestId("recall-path-graph").textContent).toContain("Gateway");
    expect(screen.getByTestId("recall-path-graph").textContent).toContain("包含");
    expect(screen.getByTestId("recall-path-graph").textContent).toContain("0.880");

    // wiki hit: title + summary + score
    const wikiHit = screen.getByTestId("recall-wiki-hit-e1");
    expect(wikiHit.textContent).toContain("DeerFlow");
    expect(wikiHit.textContent).toContain("超级智能体系统");
    expect(wikiHit.textContent).toContain("0.910");
  });

  it("expands a vector hit into the shared ChunkCard with the original text", () => {
    mockRecallTest({ data: RESULT });
    renderPanel();
    expect(screen.queryByText("切片二原文。")).toBeNull();
    fireEvent.click(screen.getByTestId("recall-vector-hit-c2"));
    expect(screen.getByText("切片二原文。")).toBeTruthy();
    fireEvent.click(screen.getByTestId("recall-vector-hit-c2"));
    expect(screen.queryByText("切片二原文。")).toBeNull();
  });

  it("opens the wiki entry drawer (overlay) instead of switching tabs", () => {
    mockRecallTest({ data: RESULT });
    const handlers = renderPanel();
    fireEvent.click(screen.getByTestId("recall-wiki-hit-e1"));
    expect(handlers.onOpenWikiEntry).toHaveBeenCalledWith("e1");
  });

  it("badges manual-card hits and opens the CARD drawer, never the wiki drawer (P6 fix)", () => {
    // 混排命中（spec §8）：卡片 id 走 wiki 条目详情接口必然 404 —— 必须分流。
    const mixed: RecallTestResponse = {
      ...RESULT,
      paths: {
        ...RESULT.paths,
        wiki: {
          hits: [
            { entry_id: "e1", title: "DeerFlow", summary: "DeerFlow 是超级智能体系统……", score: 0.91, rank: 1 },
            { entry_id: "card-1", title: "发布禁令", summary: "周五下午不发布……", score: 0.85, rank: 2, source_type: "manual" },
          ],
          message: "命中 1 篇百科条目、1 张人工知识卡片。",
        },
      },
    };
    mockRecallTest({ data: mixed });
    const onOpenManualCard = rs.fn();
    const handlers = renderPanel({ onOpenManualCard });

    const cardHit = screen.getByTestId("recall-wiki-hit-card-1");
    expect(cardHit.textContent).toContain("我的卡片");
    expect(cardHit.textContent).toContain("发布禁令");
    // wiki 命中不带卡片徽章
    expect(screen.getByTestId("recall-wiki-hit-e1").textContent).not.toContain("我的卡片");

    fireEvent.click(cardHit);
    expect(onOpenManualCard).toHaveBeenCalledWith("card-1");
    expect(handlers.onOpenWikiEntry).not.toHaveBeenCalled();
  });

  it("renders a single-path failure note without breaking other paths", () => {
    const degraded: RecallTestResponse = {
      ...RESULT,
      paths: {
        ...RESULT.paths,
        vector: { hits: [], message: "该路检索失败（RuntimeError），详情见服务端日志。" },
      },
    };
    mockRecallTest({ data: degraded });
    renderPanel();
    expect(screen.getByTestId("recall-path-vector").textContent).toContain("该路检索失败");
    expect(screen.getByTestId("recall-wiki-hit-e1")).toBeTruthy();
  });
});

// ── P6 检索联动（2026-08-15 spec §9 通道一）：结果区「在向量空间查看」──────

describe("RecallTestPanel 向量空间联动", () => {
  it("offers 在向量空间查看 on results and emits the vector hits as an overlay", () => {
    mockRecallTest({ data: RESULT });
    const onViewInVectorSpace = rs.fn();
    renderPanel({ onViewInVectorSpace });
    fireEvent.click(screen.getByRole("button", { name: "在向量空间查看" }));
    expect(onViewInVectorSpace).toHaveBeenCalledTimes(1);
    expect(onViewInVectorSpace).toHaveBeenCalledWith({
      source: "recall",
      text: "Gateway 职责",
      hits: [
        { pointId: "c1", score: 0.97 },
        { pointId: "c2", score: null },
      ],
    });
  });

  it("hides the entry before the first run and disables it when vector hits are empty", () => {
    mockRecallTest();
    const { unmount } = renderPanel({ onViewInVectorSpace: rs.fn() });
    expect(screen.queryByRole("button", { name: "在向量空间查看" })).toBeNull();
    unmount();

    // vector 路降级无命中：按钮禁用（query 还在，但没有可高亮的命中点）。
    mockRecallTest({
      data: {
        ...RESULT,
        paths: { ...RESULT.paths, vector: { hits: [], message: "未命中" } },
      },
    });
    renderPanel({ onViewInVectorSpace: rs.fn() });
    expect(screen.getByRole("button", { name: "在向量空间查看" })).toHaveProperty("disabled", true);
  });
});

// ── 存为考题 + prefill 通道（2026-08-27 spec §7，plan Task 8）─────────────

function mockAddQuestion() {
  const mutateAsync = rs.fn().mockResolvedValue({
    id: "q_new00001",
    query: "Gateway 职责",
    category: "fact",
    expected_paths: ["vector"],
    relevant_chunk_ids: [],
    relevant_entities: [],
    reference_answer: null,
  });
  (useAddEvalQuestion as unknown as ReturnType<typeof rs.fn>).mockReturnValue({
    mutateAsync,
    isPending: false,
  });
  return mutateAsync;
}

describe("RecallTestPanel 存为考题（spec §7.1）", () => {
  it("勾选命中行出现「存为考题」，全不选消失", () => {
    mockRecallTest({ data: RESULT });
    renderPanel();
    // vector 2 行 + graph evidence 1 行 = 3 个勾选框（wiki 命中不参与）
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /存为考题/ })).toBeNull();

    fireEvent.click(screen.getByTestId("recall-select-vector-c1"));
    expect(screen.getByRole("button", { name: /存为考题/ })).toBeTruthy();

    fireEvent.click(screen.getByTestId("recall-select-vector-c1"));
    expect(screen.queryByRole("button", { name: /存为考题/ })).toBeNull();
  });

  it("dialog 摘要/预填；提交体携带勾选 chunk 集；成功后清勾选不跳视图", async () => {
    mockRecallTest({ data: RESULT });
    const mutateAsync = mockAddQuestion();
    renderPanel();

    // 真实流：先输入问题（dialog 的 query 预填源是当前输入）
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "Gateway 职责" } });
    // 混路勾选（vector c2 + graph evidence c1）→ 默认勾选 = 两来源路径集合（多路化，2026-08-28）
    fireEvent.click(screen.getByTestId("recall-select-vector-c2"));
    fireEvent.click(screen.getByTestId("recall-select-graph-c1"));
    fireEvent.click(screen.getByRole("button", { name: /存为考题/ }));

    expect(screen.getAllByText("已选 2 个切片").length).toBeGreaterThan(0);
    // query 预填经 dialog open-effect 异步写入
    await waitFor(() => {
      const queryBox = screen.getByLabelText("问题") as unknown as HTMLTextAreaElement;
      expect(queryBox.value).toBe("Gateway 职责");
    });
    // 混路即多勾：来源两路均默认选中（不再降级单路）
    expect(screen.getByRole("checkbox", { name: "vector" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "graph" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ query: "Gateway 职责", category: "fact", expected_paths: ["vector", "graph"] });
    expect(body).not.toHaveProperty("expected_path");
    expect(body.relevant_chunk_ids).toEqual(["c2", "c1"]);
    expect(body).not.toHaveProperty("relevant_entities");
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已存为考题");
    });
    // 成功后清勾选：继续标注下一题，不跳视图
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /存为考题/ })).toBeNull();
    });
  });

  it("单路勾选时默认仅勾来源路径", async () => {
    mockRecallTest({ data: RESULT });
    mockAddQuestion();
    renderPanel();

    fireEvent.click(screen.getByTestId("recall-select-graph-c1"));
    fireEvent.click(screen.getByRole("button", { name: /存为考题/ }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "graph" }).getAttribute("aria-checked")).toBe("true");
    });
    expect(screen.getByRole("checkbox", { name: "vector" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("RecallTestPanel prefill 通道（spec §7.2）", () => {
  it("prefillQuery 写入输入框并消费；不自动触发检索", () => {
    const mutate = mockRecallTest();
    const onPrefillConsumed = rs.fn();
    renderPanel({ onPrefillConsumed, prefillQuery: "图谱如何检索" });

    const input = screen.getByPlaceholderText("输入测试问题…") as unknown as HTMLInputElement;
    expect(input.value).toBe("图谱如何检索");
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
    // 只预填，不替用户发起检索
    expect(mutate).not.toHaveBeenCalled();
  });

  it("无 prefill 时不消费", () => {
    mockRecallTest();
    const onPrefillConsumed = rs.fn();
    renderPanel({ onPrefillConsumed });
    expect(onPrefillConsumed).not.toHaveBeenCalled();
  });
});

// ── 百科行锚定（2026-08-28 spec §5，plan Task 10）─────────────────────

const WIKI_DOC = "d".repeat(32);

const RESULT_WITH_WIKI: RecallTestResponse = {
  ...RESULT,
  paths: {
    ...RESULT.paths,
    wiki: {
      hits: [
        // 词条：携带源切片（后端 Task 5 注入）→ 可勾选进锚定集。
        {
          entry_id: "e1",
          title: "DeerFlow",
          summary: "DeerFlow 是超级智能体系统……",
          score: 0.91,
          rank: 1,
          source_type: "wiki",
          source_chunk_ids: [`${WIKI_DOC}#0001`, `${WIKI_DOC}#0002`],
        },
        // 人工卡片：无源切片 → 不可锚定（无 checkbox，tooltip 解释）。
        { entry_id: "m1", title: "运维备忘", summary: "手工录入的卡片。", score: 0.8, rank: 2, source_type: "manual" },
      ],
      message: "命中 2 条百科结果。",
    },
  },
};

describe("RecallTestPanel 百科行锚定（spec §5）", () => {
  it("勾选词条行 → 源切片进锚定集，默认勾选含 wiki", async () => {
    mockRecallTest({ data: RESULT_WITH_WIKI });
    const mutateAsync = mockAddQuestion();
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "DeerFlow 是什么" } });
    fireEvent.click(screen.getByTestId("recall-select-wiki-e1"));

    expect(screen.getByRole("button", { name: /存为考题/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /存为考题/ }));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "wiki" }).getAttribute("aria-checked")).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.expected_paths).toEqual(["wiki"]);
    expect(body.relevant_chunk_ids).toEqual([`${WIKI_DOC}#0001`, `${WIKI_DOC}#0002`]);
  });

  it("人工卡片行无 checkbox，携带不可锚定提示", () => {
    mockRecallTest({ data: RESULT_WITH_WIKI });
    renderPanel();
    expect(screen.queryByTestId("recall-select-wiki-m1")).toBeNull();
    expect(screen.getByTitle("人工卡片无源切片，不可锚定")).toBeTruthy();
    // 词条行仍带勾选框（对照组）
    expect(screen.getByTestId("recall-select-wiki-e1")).toBeTruthy();
  });

  it("混勾（向量切片 + 百科词条）→ 默认双路，两类切片都进提交体", async () => {
    mockRecallTest({ data: RESULT_WITH_WIKI });
    const mutateAsync = mockAddQuestion();
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入测试问题…"), { target: { value: "混路题" } });
    fireEvent.click(screen.getByTestId("recall-select-vector-c1"));
    fireEvent.click(screen.getByTestId("recall-select-wiki-e1"));
    fireEvent.click(screen.getByRole("button", { name: /存为考题/ }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "vector" }).getAttribute("aria-checked")).toBe("true");
    });
    expect(screen.getByRole("checkbox", { name: "wiki" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.expected_paths).toEqual(["vector", "wiki"]);
    expect(body.relevant_chunk_ids).toEqual(["c1", `${WIKI_DOC}#0001`, `${WIKI_DOC}#0002`]);
  });
});
