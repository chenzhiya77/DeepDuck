/**
 * EvalMetricsOverview DOM tests (spec 2026-08-24 §3.3/§3.4, plan Task 2).
 *
 * Props 驱动、不内置 fetch：overview 直接由测试注入。断言覆盖 Layer 1 表格
 * 五行结构 / 单元格三态着色（阈值来自 baseline_diff.threshold_percent props，
 * 非硬编码）/ 缺失 category 灰显 / 整区空态，以及 Layer 2 卡片的 null `-` /
 * ragas 未安装 Badge / seed_hit_rate 禁用态。文案断言走 i18n 字典（zh-CN 主，
 * en-US 一个用例验证双字典）。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EvalMetricsOverview } from "@/components/workspace/knowledge/eval-metrics-overview";
import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { MetricsOverview } from "@/core/knowledge/types";

const LAYER1_METRICS: NonNullable<MetricsOverview["layer1"]>["metrics"] = {
  summary: { hit_rate: 0.928, recall_at_k: 0.897, mrr: 0.812, path_accuracy: 0.946, question_count: 20 },
  fact: { hit_rate: 0.952, recall_at_k: 0.923, mrr: 0.876, path_accuracy: 0.985, question_count: 12 },
  relation: { hit_rate: 0.881, recall_at_k: 0.854, mrr: 0.654, path_accuracy: 0.923, question_count: 4 },
  concept: { hit_rate: 0.917, recall_at_k: 0.892, mrr: 0.789, path_accuracy: 0.958, question_count: 3 },
  global: { hit_rate: 0.763, recall_at_k: 0.721, mrr: 0.543, path_accuracy: 0.812, question_count: 1 },
};

const FULL_OVERVIEW: MetricsOverview = {
  kb_id: "kb-1",
  layer1: {
    run_id: "run-l1",
    created_at: "2026-08-20T09:00:00+00:00",
    metrics: LAYER1_METRICS,
  },
  layer2: {
    run_id: "run-l2",
    created_at: "2026-08-19T21:00:00+00:00",
    ragas_available: true,
    ragas: { faithfulness: 0.933, answer_relevancy: 0.877, context_precision: 0.912, context_recall: 0.864 },
    arch_specific: { citation_precision: 0.91, citation_recall: 0.85, seed_hit_rate: 0.75 },
    langfuse_trace_url: "https://langfuse.example/trace/1",
    has_graph_questions: true,
  },
};

function renderOverview(overview: MetricsOverview, props?: { onViewTrace?: (url: string) => void }, locale: "zh-CN" | "en-US" = "zh-CN") {
  return render(
    <I18nContext.Provider value={{ locale, setLocale: () => undefined, t: locale === "zh-CN" ? zhCN : enUS }}>
      <EvalMetricsOverview overview={overview} {...props} />
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("Layer 1 表格", () => {
  it("renders five rows (4 categories + summary) with formatted values", () => {
    renderOverview(FULL_OVERVIEW);

    const table = screen.getByTestId("eval-layer1-table");
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(5);

    // category 单元格带题量后缀；指标格式化：百分比 1 位小数，MRR 3 位。
    // 行头渲染本地化显示名（tk.eval.category.*），wire 键不外露（2026-08-26 补遗）。
    expect(rows[0]?.textContent).toContain("事实 (n=12)");
    expect(rows[0]?.textContent).toContain("95.2%");
    expect(rows[0]?.textContent).toContain("92.3%");
    expect(rows[0]?.textContent).toContain("0.876");

    // 汇总行加粗并与 category 行区分。
    const summaryRow = rows[4];
    expect(summaryRow?.textContent).toContain("汇总");
    expect(summaryRow?.textContent).toContain("89.7%");
    expect(summaryRow?.className).toContain("border-t-2");
    expect(summaryRow?.className).toContain("font-semibold");
  });

  it("renders a localized five-column header row", () => {
    renderOverview(FULL_OVERVIEW);

    const headers = Array.from(
      screen.getByTestId("eval-layer1-table").querySelectorAll("thead th"),
    );
    expect(headers.map((h) => h.textContent)).toEqual(["分类", "Hit Rate", "Recall@k", "MRR", "路径准确率"]);
  });

  it("renders localized category display names instead of wire keys (zh-CN)", () => {
    renderOverview(FULL_OVERVIEW);

    const table = screen.getByTestId("eval-layer1-table");
    const rows = table.querySelectorAll("tbody tr");
    // 显示名：事实/关系/概念/全局/汇总；wire 键 fact/relation/... 不外露
    expect(rows[0]?.textContent).toContain("事实");
    expect(rows[1]?.textContent).toContain("关系");
    expect(rows[2]?.textContent).toContain("概念");
    expect(rows[3]?.textContent).toContain("全局");
    expect(rows[4]?.textContent).toContain("汇总");
    expect(table.textContent).not.toContain("fact (");
    expect(table.textContent).not.toContain("relation (");
    expect(table.textContent).not.toContain("concept (");
    expect(table.textContent).not.toContain("global (");
  });

  it("renders en-US category display names", () => {
    renderOverview(FULL_OVERVIEW, undefined, "en-US");

    const rows = screen.getByTestId("eval-layer1-table").querySelectorAll("tbody tr");
    expect(rows[0]?.textContent).toContain("Fact (n=12)");
    expect(rows[1]?.textContent).toContain("Relation");
    expect(rows[4]?.textContent).toContain("Summary");
  });

  it("passes the full variant-prefixed progress class literally so Tailwind can scan it", () => {
    renderOverview(FULL_OVERVIEW);

    // RagasCard(faithfulness=0.933 → ok 档);ArchCard(seed_hit_rate=0.75 → warn 档)
    // ——两类卡片都要拿到完整组合类,而不是运行时拼接的半成品。
    const progressOf = (testId: string) =>
      screen.getByTestId(testId).querySelector('[data-slot="progress"]')?.className ?? "";
    expect(progressOf("eval-card-faithfulness")).toContain("[&_[data-slot=progress-indicator]]:bg-(--eval-ok)");
    expect(progressOf("eval-card-seed_hit_rate")).toContain("[&_[data-slot=progress-indicator]]:bg-(--eval-warn)");
  });

  it("tints the Recall@k cells by baseline_diff delta using the backend threshold", () => {
    const regressed: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer1: {
        ...FULL_OVERVIEW.layer1!,
        baseline_diff: { recall_at_k_delta: -0.05, regression_detected: true, threshold_percent: 3.0, regressed_categories: ["fact"] },
      },
    };
    renderOverview(regressed);

    const dangerCells = screen.getAllByTestId(/eval-cell-recall-/);
    // 三态着色来自 props 阈值（-5% <= -3% → danger），汇总行与 category 行同口径。
    for (const cell of dangerCells) {
      expect(cell.className).toContain("bg-(--eval-danger-bg)");
      expect(cell.className).toContain("text-(--eval-danger-fg)");
    }
    // 回退徽章出现在 Layer 1 标题旁。
    expect(screen.getByText("检测到回退")).toBeTruthy();
  });

  it("warns (not danger) on a sub-threshold drop and leaves other columns untinted", () => {
    const mild: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer1: {
        ...FULL_OVERVIEW.layer1!,
        baseline_diff: { recall_at_k_delta: -0.02, regression_detected: false, threshold_percent: 3.0 },
      },
    };
    renderOverview(mild);

    const recallCell = screen.getByTestId("eval-cell-recall-summary");
    expect(recallCell.className).toContain("bg-(--eval-warn-bg)");
    expect(recallCell.className).toContain("text-(--eval-warn-fg)");
    // 非 Recall 列不着色。
    expect(screen.getByTestId("eval-cell-hit-summary").className).not.toContain("eval-warn");
    // 未触发门禁 → 无回退徽章。
    expect(screen.queryByText("检测到回退")).toBeNull();
  });

  it("greys out categories missing from by_category with a no-questions note", () => {
    const sparse: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer1: {
        ...FULL_OVERVIEW.layer1!,
        metrics: {
          summary: LAYER1_METRICS.summary,
          fact: LAYER1_METRICS.fact!,
          // relation / concept / global 本批次未出现
        },
      },
    };
    renderOverview(sparse);

    const missingRow = screen.getByTestId("eval-row-relation");
    expect(missingRow.className).toContain("text-muted-foreground");
    expect(missingRow.textContent).toContain("本批次无此类题目");
    // 缺失行同样用显示名而非 wire 键（2026-08-26 补遗）
    expect(missingRow.textContent).toContain("关系");
    expect(missingRow.textContent).not.toContain("relation");
    // 有数据的行不受影响。
    expect(screen.getByTestId("eval-row-fact").textContent).toContain("95.2%");
  });

  it("renders the whole-section empty state when layer1 is null", () => {
    renderOverview({ ...FULL_OVERVIEW, layer1: null });

    expect(screen.getByText("尚无 Layer 1 运行")).toBeTruthy();
    expect(screen.queryByTestId("eval-layer1-table")).toBeNull();
  });
});

describe("Layer 2 卡片", () => {
  it("renders four ragas cards and three arch-specific cards with values", () => {
    renderOverview(FULL_OVERVIEW);

    expect(screen.getByTestId("eval-card-faithfulness").textContent).toContain("0.933");
    expect(screen.getByTestId("eval-card-faithfulness").textContent).toContain("93.3%");
    expect(screen.getByTestId("eval-card-answer_relevancy").textContent).toContain("0.877");
    expect(screen.getByTestId("eval-card-context_precision").textContent).toContain("0.912");
    expect(screen.getByTestId("eval-card-context_recall").textContent).toContain("0.864");
    expect(screen.getByTestId("eval-card-citation_precision").textContent).toContain("引用准确率");
    expect(screen.getByTestId("eval-card-seed_hit_rate").textContent).toContain("种子实体命中率");
  });

  it("renders a dash and muted card for null metric values", () => {
    const withNull: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer2: {
        ...FULL_OVERVIEW.layer2!,
        ragas: { faithfulness: null, answer_relevancy: 0.877, context_precision: 0.912, context_recall: 0.864 },
      },
    };
    renderOverview(withNull);

    const card = screen.getByTestId("eval-card-faithfulness");
    expect(card.textContent).toContain("-");
    expect(card.className).toContain("bg-muted");
  });

  it("shows the ragas-missing badge and mutes ragas cards when ragas_available is false", () => {
    const missing: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer2: {
        ...FULL_OVERVIEW.layer2!,
        ragas_available: false,
        ragas_skip_reason: "ragas not installed",
        ragas: { faithfulness: null, answer_relevancy: null, context_precision: null, context_recall: null },
      },
    };
    renderOverview(missing);

    expect(screen.getByText("ragas not installed")).toBeTruthy();
    expect(screen.getByTestId("eval-card-faithfulness").className).toContain("bg-muted");
  });

  it("disables the seed_hit_rate card with a note when the batch has no graph questions", () => {
    const noGraph: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer2: { ...FULL_OVERVIEW.layer2!, has_graph_questions: false },
    };
    renderOverview(noGraph);

    const card = screen.getByTestId("eval-card-seed_hit_rate");
    expect(card.className).toContain("bg-muted");
    expect(card.textContent).toContain("本批次无 graph 类题目");
  });

  it("renders the whole-section empty state when layer2 is null", () => {
    renderOverview({ ...FULL_OVERVIEW, layer2: null });

    expect(screen.getByText("尚无 Layer 2 运行")).toBeTruthy();
    expect(screen.queryByTestId("eval-card-faithfulness")).toBeNull();
  });

  it("emits onViewTrace with the langfuse url only when the link is clicked", () => {
    const onViewTrace = rs.fn();
    renderOverview(FULL_OVERVIEW, { onViewTrace });
    fireEvent.click(screen.getByRole("button", { name: "查看 trace →" }));
    expect(onViewTrace).toHaveBeenCalledWith("https://langfuse.example/trace/1");
  });

  it("hides the trace link when langfuse_trace_url is absent", () => {
    const noTrace: MetricsOverview = {
      ...FULL_OVERVIEW,
      layer2: { ...FULL_OVERVIEW.layer2!, langfuse_trace_url: undefined },
    };
    renderOverview(noTrace, { onViewTrace: rs.fn() });

    expect(screen.queryByRole("button", { name: "查看 trace →" })).toBeNull();
  });
});

describe("i18n", () => {
  it("renders en-US copy from the dictionary", () => {
    renderOverview({ ...FULL_OVERVIEW, layer1: null }, undefined, "en-US");

    expect(screen.getByText("No Layer 1 runs yet")).toBeTruthy();
    expect(screen.getByTestId("eval-card-faithfulness").textContent).toContain("0.933");
  });

  it("renders the en-US column headers", () => {
    renderOverview(FULL_OVERVIEW, undefined, "en-US");

    const headers = Array.from(
      screen.getByTestId("eval-layer1-table").querySelectorAll("thead th"),
    );
    expect(headers.map((h) => h.textContent)).toEqual(["Category", "Hit Rate", "Recall@k", "MRR", "Path Accuracy"]);
  });
});
