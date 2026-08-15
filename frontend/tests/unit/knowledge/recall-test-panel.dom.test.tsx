/**
 * Recall-test tab (phase-2 batch-1, P1): query input + top_k + cost hint,
 * three per-path sections each annotated with its score_type and elapsed_ms.
 * Vector/graph hits expand into the shared ChunkCard; wiki hits open the
 * entry drawer via onOpenWikiEntry (overlay — never switches the middle tab).
 * Submit is disabled while a run is in flight; failures surface as a toast.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";

rs.mock("@/core/knowledge/hooks", () => ({
  useRecallTest: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn() },
}));

import { RecallTestPanel } from "@/components/workspace/knowledge/recall-test-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { useRecallTest } from "@/core/knowledge/hooks";
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
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <RecallTestPanel kbId="kb-1" {...handlers} {...props} />
    </I18nContext.Provider>,
  );
  return handlers;
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
