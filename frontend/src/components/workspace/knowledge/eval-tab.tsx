"use client";

/**
 * 评测 tab（2026-08-24 spec §5 + 2026-08-27 spec §3/§5，plan Task 5）：
 * 分段三视图（总览/题库/历史，2026-08-27 布局定案）+ 常驻工具栏——
 * 左：视图分段控件（粒度切换同款样式族，恒内联）；
 * 右：「上次运行 X 前」短文案 + 「运行评测」主动词按钮（运行中 spinner
 *     禁用；窄面板 useToolbarTier 溢出降档收进 ⋯ 菜单，只收按钮不收分段）。
 * 总览视图 = 一期现状（指标总览 + 趋势图），零改动；题库/历史为占位壳
 * （Task 6/7 落地）。数据层：useMetricsOverview / useEvalTrend /
 * useEvalRuns（enabled 门控，keep-alive 懒门控）；触发走 useTriggerEvalRun，
 * 202 语义在 onSuccess 分流成不同 toast（§5.2）；drain 边（轮询见
 * in_flight true→false）一次性失效三个评测 query——POST 不失效，避免与
 * 首次轮询双请求。点击趋势数据点开 EvalRunDrawer 下钻（plan Task 6）。
 */
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { isEvalRunning } from "@/core/knowledge/eval-run-status";
import {
  knowledgeEvalLatestKey,
  knowledgeEvalRunsKey,
  knowledgeEvalTrendKey,
  useEvalRuns,
  useEvalTrend,
  useMetricsOverview,
  useTriggerEvalRun,
} from "@/core/knowledge/hooks";
import type { TrendChartLabels, TrendQueryParams } from "@/core/knowledge/types";
import { formatTimeAgo } from "@/core/utils/datetime";

import { EvalMetricsOverview } from "./eval-metrics-overview";
import { EvalQuestionBank } from "./eval-question-bank";
import { EvalRunDrawer } from "./eval-run-drawer";
import type { EvalTrendChartProps } from "./eval-trend-chart";

const EvalTrendChart = dynamic<EvalTrendChartProps>(() => import("./eval-trend-chart"), {
  ssr: false,
});

type Granularity = TrendQueryParams["granularity"];
type EvalView = "overview" | "questions" | "history";

const GRANULARITIES = ["day", "week", "month"] as const;
const EVAL_VIEWS = ["overview", "questions", "history"] as const;

/** 档级：0=控件内联 1=收进 ⋯ 菜单（单工具栏只有一组可收控件，两档够用）。 */
type ToolbarTier = 0 | 1;

/**
 * 工具栏自适应降级（vector-tab useToolbarTier 先例，两档版）：固定像素断点
 * 估不准真实渲染宽度，直接检测溢出——scrollWidth > clientWidth 即升档；
 * 升档时记录当前 scrollWidth 作为回落恢复点（+4px 防亚像素抖动）。
 * jsdom 无布局（scrollWidth 恒 0）→ 恒 0 档，窄档用例钉 scrollWidth 模拟。
 */
function useToolbarTier(ref: RefObject<HTMLDivElement | null>): ToolbarTier {
  const [tier, setTier] = useState<ToolbarTier>(0);
  const tierRef = useRef<ToolbarTier>(0);
  const restoreWidth = useRef<[number, number]>([0, 0]);

  const evaluate = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.clientWidth;
    const overflow = element.scrollWidth > width + 1;
    const current = tierRef.current;
    if (overflow && current < 1) {
      // 记录当前档位内容的需求宽度——回落到本档的精确触发点。
      restoreWidth.current[current + 1] = element.scrollWidth + 4;
      tierRef.current = 1;
      setTier(1);
    } else if (!overflow && current > 0 && width >= restoreWidth.current[current]) {
      tierRef.current = 0;
      setTier(0);
    }
  }, [ref]);

  // 每次渲染后校准（幂等：档级不变则不 setState，不自激）——覆盖文案长度
  // 变化（i18n 切换）与档级切换后的级联再评估。
  useEffect(() => {
    evaluate();
  });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(evaluate);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, evaluate]);

  return tier;
}

export interface EvalTabProps {
  kbId: string;
  /** keep-alive pane 的懒加载门：仅评测 tab 激活后才发请求（page 层下发）。 */
  enabled: boolean;
  /** ↗ 复现通道（§7.2）：题库/详情携带 query 跳召回面板预填（page 层透传）。 */
  onReproduce?: (query: string) => void;
}

export function EvalTab({ kbId, enabled, onReproduce }: EvalTabProps) {
  const { t, locale } = useI18n();
  const tk = t.knowledge.eval;
  const queryClient = useQueryClient();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarTier = useToolbarTier(toolbarRef);
  const viewToolbarRef = useRef<HTMLDivElement>(null);
  const viewToolbarTier = useToolbarTier(viewToolbarRef);
  // 视图 state 在组件本地（不进 URL——知识库页 tab 本就是本地 state）。
  const [view, setView] = useState<EvalView>("overview");
  // 粒度 state 在组件内（进 queryKey，切换自动重新请求）。
  const [granularity, setGranularity] = useState<Granularity>("day");
  // 点击下钻：drawer 打开时携带该 runId（EvalRunDrawer 内 useEvalRun 拉详情）。
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);

  const overviewQuery = useMetricsOverview(kbId, enabled);
  const trendQuery = useEvalTrend(kbId, granularity, enabled);
  const runsQuery = useEvalRuns(kbId, enabled);
  const triggerMutation = useTriggerEvalRun(kbId);
  // 点击→首次轮询间隙由 isPending 补位（eval-run-status 纯函数）。
  const running = isEvalRunning(runsQuery.data, triggerMutation.isPending);
  const lastRun = runsQuery.data?.runs[0];

  const handleTrigger = useCallback(() => {
    triggerMutation.mutate(undefined, {
      onSuccess: (response) => {
        // 202 语义分流（§5.2）：enqueued 确认；already_running 幂等提示。
        if (response.status === "enqueued") toast.success(tk.runStartedToast);
        else toast.info(tk.alreadyRunningToast);
      },
      onError: () => toast.error(tk.runFailedToast),
    });
  }, [triggerMutation, tk]);

  // drain 边（§5.2）：轮询见 in_flight true→false 一次性失效三个评测 query，
  // 总览/趋势/历史自动刷新；初始挂载与持续运行不触发（ref 记忆前值）。
  const prevInFlight = useRef(false);
  const inFlight = runsQuery.data?.in_flight ?? false;
  useEffect(() => {
    const drained = prevInFlight.current && !inFlight;
    prevInFlight.current = inFlight;
    if (!drained) return;
    void queryClient.invalidateQueries({ queryKey: knowledgeEvalRunsKey(kbId) });
    void queryClient.invalidateQueries({ queryKey: knowledgeEvalLatestKey(kbId) });
    void queryClient.invalidateQueries({ queryKey: knowledgeEvalTrendKey(kbId, granularity) });
  }, [inFlight, kbId, granularity, queryClient]);

  // canvas 文案包：eval-trend-chart 保持纯渲染不调 useI18n（spec §3.6）。
  const chartLabels: TrendChartLabels = {
    recallAtK: tk.trend.recallAtK,
    hitRate: tk.trend.hitRate,
    mrr: tk.trend.mrr,
    faithfulness: tk.trend.faithfulness,
    answerRelevancy: tk.trend.answerRelevancy,
    contextPrecision: tk.trend.contextPrecision,
    thresholdLine: tk.trend.thresholdLine,
    thresholdLabel: tk.trend.thresholdLabel,
    baselineUpdate: tk.trend.baselineUpdate,
    clickForDetail: tk.trend.clickForDetail,
    regressionPrefix: tk.trend.regressionPrefix,
  };

  const runButtonLabel = running ? tk.runningButton : tk.runButton;

  return (
    // 与文档 tab 同一滚动模型（document-panel）：面板容器 overflow-auto + 内容自带
    // min-w 下限（4 张指标卡 × ~6.75rem + 间距与 px-4 = 32rem，卡内容区 ~76px 仍容得下
    // text-lg 的 "100.0%" 与 3 字标题+ⓘ）；栏宽低于下限时整 tab 横向滚动，而不是裁切卡片。
    <div className="h-full min-h-0 overflow-auto" data-testid="eval-tab">
      <div className="flex min-w-[32rem] flex-col gap-4 px-4 py-3">
        {/* 常驻工具栏（§5）：三视图共享，主动词恒可达 */}
        <div
          ref={viewToolbarRef}
          className="flex items-center gap-2 overflow-hidden whitespace-nowrap"
          data-testid="eval-view-toolbar"
        >
          <div aria-label={tk.viewSwitchLabel} className="bg-muted flex shrink-0 rounded-md p-0.5" role="radiogroup">
            {EVAL_VIEWS.map((v) => (
              <button
                key={v}
                aria-checked={view === v}
                className={`rounded px-2 py-0.5 text-xs ${view === v ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                role="radio"
                type="button"
                onClick={() => setView(v)}
              >
                {tk.views[v]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!running && (
              <span className="text-muted-foreground text-xs">
                {lastRun?.created_at
                  ? `${tk.lastRunLabel} ${formatTimeAgo(lastRun.created_at, locale)}`
                  : tk.neverRan}
              </span>
            )}
            {viewToolbarTier === 0 ? (
              <Button disabled={running} size="sm" onClick={handleTrigger}>
                {running && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                {runButtonLabel}
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={tk.moreOptions} size="sm" variant="ghost">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={running} onClick={handleTrigger}>
                    {runButtonLabel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {view === "overview" && (
          <>
            {/* 指标总览（Layer 1 表格 + Layer 2 卡片）：loading / 错误 / 数据三态 */}
            {overviewQuery.isLoading ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                {tk.loading}
              </div>
            ) : overviewQuery.error ? (
              <div className="text-destructive rounded-lg border border-dashed p-6 text-center text-sm">
                {tk.loadFailed}
              </div>
            ) : overviewQuery.data ? (
              <EvalMetricsOverview overview={overviewQuery.data} />
            ) : null}

            {/* 趋势图卡片壳：标题 + 粒度切换（窄面板收进 ⋯ 菜单）+ canvas/空态 */}
            <section className="rounded-lg border p-3">
              <div
                ref={toolbarRef}
                className="mb-2 flex items-center gap-2 overflow-hidden whitespace-nowrap"
                data-testid="eval-trend-toolbar"
              >
                <span className="text-sm font-semibold">{tk.trendTitle}</span>
                <div className="ml-auto flex shrink-0 items-center">
                  {toolbarTier === 0 ? (
                    <div
                      aria-label={tk.granularityLabel}
                      className="bg-muted flex rounded-md p-0.5"
                      role="radiogroup"
                    >
                      {GRANULARITIES.map((g) => (
                        <button
                          key={g}
                          aria-checked={granularity === g}
                          className={`rounded px-2 py-0.5 text-xs ${
                            granularity === g ? "bg-background shadow-sm" : "text-muted-foreground"
                          }`}
                          role="radio"
                          type="button"
                          onClick={() => setGranularity(g)}
                        >
                          {tk.granularity[g]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label={tk.moreOptions} size="sm" variant="ghost">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup
                          value={granularity}
                          onValueChange={(value) => setGranularity(value as Granularity)}
                        >
                          {GRANULARITIES.map((g) => (
                            <DropdownMenuRadioItem key={g} value={g}>
                              {tk.granularity[g]}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
              {trendQuery.isLoading ? (
                <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                  {tk.loading}
                </div>
              ) : trendQuery.error ? (
                <div className="text-destructive rounded-lg border border-dashed p-6 text-center text-sm">
                  {tk.loadFailed}
                </div>
              ) : trendQuery.data ? (
                trendQuery.data.has_data ? (
                  <EvalTrendChart
                    baseline={trendQuery.data.baseline}
                    granularity={trendQuery.data.granularity}
                    labels={chartLabels}
                    points={trendQuery.data.points}
                    onPointClick={setDrawerRunId}
                  />
                ) : (
                  /* 新 KB 无评测历史：空态提示而非空白画布（2026-08-26 补） */
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {tk.emptyTrend}
                  </div>
                )
              ) : null}
            </section>
          </>
        )}

        {view === "questions" && (
          /* 题库视图（Task 6）：表格 + 详情 drawer + 添加 dialog + 删除确认 */
          <EvalQuestionBank enabled={enabled} kbId={kbId} onReproduce={onReproduce} />
        )}

        {view === "history" && (
          /* 历史视图占位壳——Task 7 落地运行列表行 + 复用 EvalRunDrawer 下钻 */
          <div
            className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm"
            data-testid="eval-history-view"
          >
            {tk.history.emptyHistory}
          </div>
        )}
      </div>

      {/* 点击趋势图数据点 → drawer 下钻单次运行详情（portal 渲染，保持在 min-w 内包装之外） */}
      <EvalRunDrawer
        kbId={kbId}
        open={drawerRunId !== null}
        runId={drawerRunId}
        onOpenChange={(next) => {
          if (!next) setDrawerRunId(null);
        }}
      />
    </div>
  );
}
