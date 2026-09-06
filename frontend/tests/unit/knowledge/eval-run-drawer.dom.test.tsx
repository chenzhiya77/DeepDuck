/**
 * 单次评测运行详情 drawer 壳（2026-08-24 spec §5，plan Task 6）：
 * - 趋势图数据点点击下钻的数据源（useEvalRun mock 注入）；
 * - 渲染 run 元信息（run_id / created_at / environment / status / 基线徽标）
 *   + 两层指标只读摘要；Layer 2 的 path_accuracy 口径标注必须可见
 *   （与 Layer 1 同名指标口径不同，spec §5 冻结契约）；
 * - 层未执行（*_metrics 为 {}）渲染「未执行」提示；
 * - onOpenChange(false) 关闭（对齐 ChunkDrawer 的 Sheet 模式）。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const hooksMock = rs.hoisted(() => ({
  useEvalRun: rs.fn(),
}));

rs.mock("@/core/knowledge/hooks", () => ({
  useEvalRun: hooksMock.useEvalRun,
}));

import { EvalRunDrawer } from "@/components/workspace/knowledge/eval-run-drawer";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { EvalRunDetail } from "@/core/knowledge/types";

const EVAL_RUN: EvalRunDetail = {
  run_id: "run-l1-1",
  kb_id: "kb-1",
  status: "completed",
  environment: "local",
  created_at: "2026-08-20T09:00:00+00:00",
  layer1_metrics: {
    summary: { hit_rate: 0.928, recall_at_k: 0.897, mrr: 0.812, path_accuracy: 0.946, question_count: 20 },
    fact: { hit_rate: 0.952, recall_at_k: 0.923, mrr: 0.876, path_accuracy: 0.985, question_count: 12 },
  },
  layer2_metrics: {
    ragas_available: true,
    ragas: { faithfulness: 0.933, answer_relevancy: 0.877, context_precision: 0.912, context_recall: 0.864 },
    arch_specific: { citation_precision: 0.91, citation_recall: 0.85, seed_hit_rate: 0.75 },
    langfuse_trace_url: "https://langfuse.example/trace/1",
    has_graph_questions: true,
    path_accuracy: 0.87,
  },
  baseline_diff: { recall_at_k_delta: -0.01, regression_detected: false, threshold_percent: 3 },
  is_baseline: true,
};

function renderDrawer(props?: { runId?: string | null; onOpenChange?: (open: boolean) => void }) {
  const onOpenChange = props?.onOpenChange ?? rs.fn();
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <EvalRunDrawer
        kbId="kb-1"
        open
        runId={props?.runId === undefined ? "run-l1-1" : props.runId}
        onOpenChange={onOpenChange}
      />
    </I18nContext.Provider>,
  );
  return { onOpenChange };
}

describe("EvalRunDrawer", () => {
  beforeEach(() => {
    hooksMock.useEvalRun.mockReset();
    hooksMock.useEvalRun.mockReturnValue({ data: EVAL_RUN, isLoading: false, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches via useEvalRun with kbId+runId and renders run metadata", () => {
    renderDrawer();
    expect(hooksMock.useEvalRun).toHaveBeenCalledWith("kb-1", "run-l1-1");
    // 元信息：run_id / 运行时间 / 环境 / 状态（本地化徽标）/ 基线徽标
    expect(screen.getByText("run-l1-1")).toBeTruthy();
    expect(screen.getByText("运行 ID")).toBeTruthy();
    expect(screen.getByText("环境")).toBeTruthy();
    expect(screen.getByText("local")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("基线")).toBeTruthy();
  });

  it("renders both layer summaries including the Layer 2 path_accuracy caveat", () => {
    renderDrawer();
    // 检索质量：summary 行四指标 + 题量（区块标题已去 Layer 术语，2026-08-27 方案 A）
    expect(screen.getByText("检索质量")).toBeTruthy();
    expect(screen.getByText("89.7%")).toBeTruthy(); // recall_at_k 0.897
    expect(screen.getByText("92.8%")).toBeTruthy(); // hit_rate 0.928
    expect(screen.getByText("81.2%")).toBeTruthy(); // mrr（数值语言统一后同走百分数）
    // 生成质量：RAGAS 四项 + 架构专属三项 + path_accuracy 及口径标注
    // （RAGAS 行名与总览卡/趋势图例同词汇，2026-09-05 闭环后为中文）。
    expect(screen.getByText("生成质量")).toBeTruthy();
    expect(screen.getByText("忠实度")).toBeTruthy();
    expect(screen.getByText("上下文召回率")).toBeTruthy();
    expect(screen.getByText("引用准确率")).toBeTruthy();
    expect(screen.getByText("路径准确率（对话链路）")).toBeTruthy();
    expect(screen.getByText("87.0%")).toBeTruthy();
    expect(
      screen.getByText(/与检索质量表格中同名指标口径不同/),
    ).toBeTruthy();
  });

  it("renders not-executed hints for layers whose metrics are empty objects", () => {
    hooksMock.useEvalRun.mockReturnValue({
      data: {
        ...EVAL_RUN,
        layer1_metrics: {},
        layer2_metrics: {},
      },
      isLoading: false,
      error: null,
    });
    renderDrawer();
    const hints = screen.getAllByText("本次运行未执行该层");
    expect(hints.length).toBe(2);
    expect(screen.queryByText("路径准确率（对话链路）")).toBeNull();
  });

  it("shows loading then error copy from the query state", () => {
    hooksMock.useEvalRun.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderDrawer();
    expect(screen.getByText("加载中…")).toBeTruthy();

    cleanup();
    hooksMock.useEvalRun.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom") });
    renderDrawer();
    expect(screen.getByText("评测数据加载失败")).toBeTruthy();
  });

  it("cancelled 行状态徽标显「已终止」（spec §11，不再落入 skipped 兑底）", () => {
    hooksMock.useEvalRun.mockReturnValue({
      data: { ...EVAL_RUN, status: "cancelled" },
      isLoading: false,
      error: null,
    });
    renderDrawer();
    expect(screen.getByText("已终止")).toBeTruthy();
    expect(screen.queryByText("已跳过")).toBeNull();
  });

  it("closes via onOpenChange(false)", () => {
    const { onOpenChange } = renderDrawer();
    // shadcn SheetContent 自带关闭按钮（sr-only 文本 Close）
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when runId is null (drawer closed)", () => {
    renderDrawer({ runId: null });
    expect(screen.queryByText("评测运行详情")).toBeNull();
  });
});
