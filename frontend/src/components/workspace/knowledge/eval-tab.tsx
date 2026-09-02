"use client";

/**
 * 评测 tab（2026-08-24 spec §5 + 2026-08-27 spec §3/§5，plan Task 5）：
 * 分段三视图（总览/题库/历史，2026-08-27 布局定案）+ 常驻工具栏——
 * 左：视图分段控件（粒度切换同款样式族，恒内联；底色块样式与顶部知识库大
 *     tab 的下划线样式做层级区分，2026-08-29 定案保留）；
 * 右：「运行评测」主动词按钮（h-7 紧凑档，行高 44 对齐文档/百科/向量/图谱工具栏基准，
 *     运行中 spinner 禁用；窄面板 useToolbarTier 溢出降档收进 ⋯ 菜单，
 *     只收按钮不收分段）。2026-08-28 反馈：上次运行文案与状态切换的高度跳动去掉——
 *     运行状态由按钮自身表达，历史时间在历史视图首行仍可见。2026-08-29 UX 修订：题库造题入口
 *     （添加考题/从文档生成）并入本工具栏右侧，仅题库视图出现，状态提升
 *     到本层驱动 bank 的受控 dialog——避免第二条工具栏叠加与入口沉底。
 * 总览视图 = 一期现状（指标总览 + 趋势图），零改动；题库/历史为占位壳
 * （Task 6/7 落地）。数据层：useMetricsOverview / useEvalTrend /
 * useEvalRuns（enabled 门控，keep-alive 懒门控）；触发走 useTriggerEvalRun，
 * 202 语义在 onSuccess 分流成不同 toast（§5.2）；drain 边（轮询见
 * in_flight true→false）一次性失效三个评测 query——POST 不失效，避免与
 * 首次轮询双请求。点击趋势数据点开 EvalRunDrawer 下钻（plan Task 6）。
 */
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, MoreHorizontal, Play, Plus, Search, Sparkles, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
import type { EvalTriggerInput, TrendChartLabels, TrendQueryParams } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { EvalFullRunDialog } from "./eval-full-run-dialog";
import { EvalMetricsOverview } from "./eval-metrics-overview";
import { EvalQuestionBank } from "./eval-question-bank";
import { EvalRunDrawer } from "./eval-run-drawer";
import { EvalRunHistory } from "./eval-run-history";
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
  const { t } = useI18n();
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
  // 题库造题入口受控状态（2026-08-29）：按钮在本层工具栏，dialog 在 bank 内。
  const [bankAddOpen, setBankAddOpen] = useState(false);
  const [bankSynthesisOpen, setBankSynthesisOpen] = useState(false);
  // 完整评测确认对话框（2026-09-01 B 方案）：箭头菜单/⋯ 菜单打开，确认后触发 l1_l2 档。
  const [fullRunOpen, setFullRunOpen] = useState(false);
  // 题库搜索（2026-08-30）：搜索框常驻本层工具栏，纯前端过滤，经 prop 下发。
  const [bankSearchQuery, setBankSearchQuery] = useState("");
  // 选题集上提（2026-09-02 批量运行栏退役）：工具栏原位切换需读选中态，
  // 右键菜单的快捷运行/清理也在 bank 内——状态居本层，双向经 props。
  const [bankSelectedIds, setBankSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const overviewQuery = useMetricsOverview(kbId, enabled);
  const trendQuery = useEvalTrend(kbId, granularity, enabled);
  const runsQuery = useEvalRuns(kbId, enabled);
  const triggerMutation = useTriggerEvalRun(kbId);
  // 点击→首次轮询间隙由 isPending 补位（eval-run-status 纯函数）。
  const running = isEvalRunning(runsQuery.data, triggerMutation.isPending);

  const handleTrigger = useCallback(
    (input: EvalTriggerInput) => {
      triggerMutation.mutate(input, {
        onSuccess: (response) => {
          // 202 语义分流（§5.2）：enqueued 确认；already_running 幂等提示。
          if (response.status === "enqueued") toast.success(tk.runStartedToast);
          else toast.info(tk.alreadyRunningToast);
          // 选题运行成功后清空选择集（原批量栏语义，2026-09-02 承接）。
          if (input.question_ids) setBankSelectedIds(new Set());
        },
        onError: () => toast.error(tk.runFailedToast),
      });
    },
    [triggerMutation, tk],
  );

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
  // 工具栏原位切换（2026-09-02 B 方案承接）：题库视图且有选中时，运行主键
  // 与完整评测档都改携 question_ids，标签切「运行所选/完整运行所选」；
  // 选题集跨视图持久（state 在本层），仅题库视图消费，不泄漏到总览/历史。
  const bankSelectionActive = view === "questions" && bankSelectedIds.size > 0;
  const bankQuestionIds = bankSelectionActive ? [...bankSelectedIds] : undefined;
  const runLabel = bankSelectionActive ? tk.selection.runSelected : runButtonLabel;
  const fullRunLabel = bankSelectionActive ? tk.selection.fullRunSelected : tk.fullRun.menuItem;
  const runInput = (layers: "l1" | "l1_l2"): EvalTriggerInput =>
    bankQuestionIds ? { layers, question_ids: bankQuestionIds } : { layers };

  return (
    // 滚动模型（对齐 document-panel 头部行 + 内容表格 min-w 的同构做法）：工具栏
    // 固定全宽永不横滚（挤压走 tier 降档）；内容区独立纵向滚动；32rem 下限只属于
    // 指标总览块（4 卡数学下限）——压缩时仅卡片区域横滚，「谁有下限，谁自己滚」。
    <div className="flex h-full min-h-0 flex-col" data-testid="eval-tab">
        {/* 常驻工具栏（§5）：三视图共享，主动词恒可达；tier 1 时状态文案让位；
            底边不画线（2026-09-02，与文档 tab 对齐）：表头自带吸顶发丝线，
            两条线夹表头的问题同款修复，靠留白分界 */}
        <div
          ref={viewToolbarRef}
          className="flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap px-4 py-2"
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
          {/* 题库搜索（2026-08-30 定案）：常驻不展开/收起，仅题库视图出现；
              分段控件与动作按钮之间，h-7 与栏内控件同档；✕ 清除同百科先例。
              窄面板溢出时按钮走 ⋯ 降档，搜索框保留（只收按钮不收搜索）。 */}
          {view === "questions" && (
            <div className="relative ml-auto w-full min-w-40 max-w-64 shrink">
              <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
              <Input
                aria-label={tk.questions.searchPlaceholder}
                className="h-7 pr-6 pl-7 text-xs"
                placeholder={tk.questions.searchPlaceholder}
                value={bankSearchQuery}
                onChange={(event) => setBankSearchQuery(event.target.value)}
              />
              {bankSearchQuery && (
                <button
                  aria-label={tk.questions.searchClear}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
                  type="button"
                  onClick={() => setBankSearchQuery("")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
          <div className={cn("flex shrink-0 items-center gap-2", view !== "questions" && "ml-auto")}>
            {viewToolbarTier === 0 ? (
              // 紧凑档：全栏按钮锁 h-7（2026-08-29 定案：行高 44 = 文档工具栏基准，
              // 原 h-6 降档已回退）；锁运行前后高度恒定不跳动；
              // 题库视图时造题入口并入（动作在前，主动词恒最右主位）
              <>
                {view === "questions" && (
                  <>
                    <Button
                      className="h-7 shrink-0 gap-1.5 px-2.5"
                      onClick={() => setBankAddOpen(true)}
                      variant="outline"
                    >
                      <Plus className="size-3.5" />
                      {tk.questions.addQuestion}
                    </Button>
                    <Button
                      className="h-7 shrink-0 gap-1.5 px-2.5"
                      onClick={() => setBankSynthesisOpen(true)}
                      variant="outline"
                    >
                      <Sparkles className="size-3.5" />
                      {tk.synthesize.entryButton}
                    </Button>
                  </>
                )}
                {/* 三按钮统一紧凑档（2026-08-30）：gap-1.5 + px-2.5（vector-tab chips 同款
                    收窄，同内边距不跳宽）；不降字号，保住主动词视觉权重。 */}
                {/* 分体按钮（2026-09-01 B 方案）：主键一键 L1 快速档（高频习惯不变），
                    右侧箭头下拉选完整评测（确认对话框）；两段视觉拼成一枚按钮，
                    锁 h-7 同档；降档时两段一并收进 ⋯ 菜单。 */}
                <div className="flex shrink-0 items-stretch">
                  <Button
                    className="h-7 shrink-0 gap-1.5 rounded-r-none px-2.5"
                    disabled={running}
                    onClick={() => handleTrigger(runInput("l1"))}
                  >
                    {running ? (
                      <Loader2 aria-hidden className="size-3.5 animate-spin" />
                    ) : (
                      <Play aria-hidden className="size-3.5" />
                    )}
                    {runLabel}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={tk.fullRun.menuAria}
                        className="h-7 shrink-0 rounded-l-none border-l border-primary-foreground/25 px-1"
                        disabled={running}
                      >
                        <ChevronDown aria-hidden className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setFullRunOpen(true)}>{fullRunLabel}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* size-7（28px）与内联按钮 h-7 同高——size=sm（h-8=32px）会把降档后的
                      工具栏撑高 4px（2026-08-30 切题库栏高突跳根因，document-panel 同款先例）。 */}
                  <Button aria-label={tk.moreOptions} className="size-7" size="icon-sm" variant="ghost">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {view === "questions" && (
                    <>
                      <DropdownMenuItem onClick={() => setBankAddOpen(true)}>
                        {tk.questions.addQuestion}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setBankSynthesisOpen(true)}>
                        {tk.synthesize.entryButton}
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem disabled={running} onClick={() => handleTrigger(runInput("l1"))}>
                    {runLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={running} onClick={() => setFullRunOpen(true)}>
                    {fullRunLabel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* 内容区：纵向滚动（document-panel 同款）；各视图内容。
            题库视图通栏（文档列表同款）：水平拉满且顶边无内距，表格拉满全宽、
            表头紧贴常驻工具栏下沿（分界线四边对齐）；总览/历史保持 px-4 py-3。 */}
        <div
          className={cn("min-h-0 flex-1 overflow-auto", view === "questions" ? "px-0 pt-0 pb-3" : "px-4 py-3")}
          data-testid="eval-view-content"
        >
          <div className="flex min-w-0 flex-col gap-4">
        {view === "overview" && (
          <>
            {/* 指标总览块：32rem 下限只在这里（4 卡数学下限）——压缩时仅此块横滚 */}
            <div className="overflow-x-auto" data-testid="eval-overview-scroll">
              <div className="min-w-[32rem]">
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
              </div>
            </div>

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
                        {/* size-7 与粒度按钮组内联控件同高（同视图工具栏 ⋯ 先例）。 */}
                        <Button aria-label={tk.moreOptions} className="size-7" size="icon-sm" variant="ghost">
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
          /* 题库视图（Task 6）：表格 + 详情 drawer + 受控添加/合成 dialog + 删除确认；
           * 造题入口按钮在常驻工具栏（2026-08-29），状态由本层下发 */
          <EvalQuestionBank
            addOpen={bankAddOpen}
            enabled={enabled}
            kbId={kbId}
            searchQuery={bankSearchQuery}
            selectedIds={bankSelectedIds}
            synthesisOpen={bankSynthesisOpen}
            onAddOpenChange={setBankAddOpen}
            onReproduce={onReproduce}
            onSearchQueryChange={setBankSearchQuery}
            onSelectedIdsChange={setBankSelectedIds}
            onSynthesisOpenChange={setBankSynthesisOpen}
          />
        )}

        {view === "history" && (
          /* 历史视图（Task 7）：运行列表行，行点击复用既有 EvalRunDrawer 实例下钻 */
          <EvalRunHistory enabled={enabled} kbId={kbId} onOpenRun={setDrawerRunId} />
        )}
          </div>
        </div>

      {/* 完整评测确认对话框（2026-09-01 B 方案）：箭头/⋯ 菜单打开，确认后触发
          l1_l2 档；题库视图有选中时携 question_ids（原批量栏的完整运行所选） */}
      <EvalFullRunDialog
        open={fullRunOpen}
        onOpenChange={setFullRunOpen}
        onConfirm={() => handleTrigger(runInput("l1_l2"))}
      />

      {/* 点击趋势图数据点 → drawer 下钻单次运行详情（portal 渲染） */}
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
