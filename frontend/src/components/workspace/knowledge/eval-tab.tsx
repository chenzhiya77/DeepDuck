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
import {
  Check,
  ChevronDown,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import {
  EVAL_PHASE_COUNT,
  isEvalRunning,
  phaseStep,
  runningTier,
  type EvalTier,
} from "@/core/knowledge/eval-run-status";
import {
  knowledgeEvalLatestKey,
  knowledgeEvalRunsKey,
  knowledgeEvalTrendKey,
  useEvalRuns,
  useEvalTrend,
  useMetricsOverview,
  useTriggerEvalRun,
} from "@/core/knowledge/hooks";
import type {
  EvalRunListResponse,
  EvalTriggerInput,
  TrendChartLabels,
  TrendQueryParams,
} from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { EvalFullRunDialog } from "./eval-full-run-dialog";
import { EvalMetricsOverview } from "./eval-metrics-overview";
import { EvalQuestionBank } from "./eval-question-bank";
import { EvalRunBanner } from "./eval-run-banner";
import { EvalRunDrawer } from "./eval-run-drawer";
import { EvalRunHistory } from "./eval-run-history";
import type { EvalTrendChartProps } from "./eval-trend-chart";

const EvalTrendChart = dynamic<EvalTrendChartProps>(
  () => import("./eval-trend-chart"),
  {
    ssr: false,
  },
);

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
    } else if (
      !overflow &&
      current > 0 &&
      width >= restoreWidth.current[current]
    ) {
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
  // 趋势卡收起态（2026-09-05）：头部左簇 toggle 整块点击，与总览两卡/
  // 检索测试路容器同词汇（chevron 退役）。
  const [trendCollapsed, setTrendCollapsed] = useState(false);
  // 选题集上提（2026-09-02 批量运行栏退役）：工具栏原位切换需读选中态，
  // 右键菜单的快捷运行/清理也在 bank 内——状态居本层，双向经 props。
  const [bankSelectedIds, setBankSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // 评测档位（2026-09-06 档位单选重设计）：会话内记忆的单选状态（默认快速档）。
  // 主按钮恒显勾中档位名并执行该档；chevron 下拉为互斥单选。取代旧"主键=L1 硬
  // 编码 + 下拉=完整"的不对称结构，也取代 pendingFullRun 的触发瞬间推断（完整档
  // 计数改由 tier 直接判定）。
  const [tier, setTier] = useState<EvalTier>("l1");
  // 在飞/最近一次触发所用的档位（与“下一次运行”的单选分开，spec 2026-09-06 §9）：
  // 从题库右键/行⋮ 触发的完整档不应被单选（快速档）覆盖进度条几何。
  const [runTier, setRunTier] = useState<EvalTier | null>(null);
  // 完整档确认弹窗的运行范围（所选题 id）；缺省=全库。头部/⋯/题库右键·行⋮ 的
  // 完整档入口统一收口到该弹窗（成本+范围提醒器）。
  const [fullRunScope, setFullRunScope] = useState<string[] | undefined>(undefined);

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
          if (response.status === "enqueued") {
            toast.success(tk.runStartedToast);
            // 记录在飞那次的档位（spec §9）：档位单选表达的是“下一次运行”。
            setRunTier(input.layers ?? "l1");
            // 无条件乐观置位（spec 2026-09-06 run-progress 修订）：缓存存在则并入
            // in_flight=true，缓存为空则**创建**最小条目。旧写法（old ? … : old，
            // 空缓存退化 invalidate）在空缓存时撞上后端 create_task 延迟自增
            // _IN_FLIGHT 的竞态——即时 refetch 拿回 in_flight=false → 按钮不亮、
            // refetchInterval 不启动，非切历史（挂第二个 observer 再 refetch）不
            // 复活。创建条目让按钮立即转运行态、3s 轮询立即接管，绕开竞态。
            queryClient.setQueryData<EvalRunListResponse>(
              knowledgeEvalRunsKey(kbId),
              (old) => ({
                runs: old?.runs ?? [],
                total: old?.total ?? 0,
                progress: old?.progress ?? null,
                in_flight: true,
              }),
            );
          } else {
            toast.info(tk.alreadyRunningToast);
          }
          // 选题运行成功后清空选择集（原批量栏语义，2026-09-02 承接）。
          if (input.question_ids) setBankSelectedIds(new Set());
        },
        onError: () => toast.error(tk.runFailedToast),
      });
    },
    [triggerMutation, tk, kbId, queryClient],
  );

  // drain 边（§5.2）：轮询见 in_flight true→false 一次性失效三个评测 query，
  // 总览/趋势/历史自动刷新；初始挂载与持续运行不触发（ref 记忆前值）。
  const prevInFlight = useRef(false);
  const inFlight = runsQuery.data?.in_flight ?? false;
  useEffect(() => {
    const drained = prevInFlight.current && !inFlight;
    prevInFlight.current = inFlight;
    if (!drained) return;
    void queryClient.invalidateQueries({
      queryKey: knowledgeEvalRunsKey(kbId),
    });
    void queryClient.invalidateQueries({
      queryKey: knowledgeEvalLatestKey(kbId),
    });
    void queryClient.invalidateQueries({
      queryKey: knowledgeEvalTrendKey(kbId, granularity),
    });
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

  // 运行进度（spec 2026-09-06 run-progress / §9）：progress 走 /eval-runs 顶层字段。
  // 底缘细线已退役——它只表征 questions 段（用户口中的“假进度条”）；富进度改由
  // 总览的 EvalRunBanner 承载（时长加权条 + ETA + 单行日志），按钮只留 4 字阶段名 + n/3。
  const progress = runsQuery.data?.progress ?? null;
  // 在飞那次的档位：触发时记录（runTier），刷新后按 phase 兜底推断，最后回退单选。
  const bannerTier = runningTier(progress, runTier, tier);

  // 运行态按钮文案（用户定案）：4 字阶段名 + n/3，与「运行评测/完整评测」等 4 字
  // 按钮对齐。快速档（L1 单阶段）不显计数——避免"1/3 却到不了 3/3"的新假状态；
  // 完整档 layer1 显 1/3，questions/ragas 恒显 2/3、3/3（step>1 与档位无关）。
  // k/N 不进按钮（破坏对齐），改由总览容器的加权条 + aria-valuenow 承载。
  const step = phaseStep(progress);
  const phaseName =
    progress?.phase === "questions"
      ? tk.phaseQuestions
      : progress?.phase === "ragas"
        ? tk.phaseRagas
        : tk.phaseLayer1;
  const showCounter = bannerTier === "l1_l2" || step > 1;
  // 主按钮文案（2026-09-06 档位单选）：运行态=阶段名+n/3；空闲态=勾中档位名
  // （恒 4 字、不随选中题目变脸；"只跑所选"的范围改由确认弹窗承载）。
  const tierName = tier === "l1_l2" ? tk.tierFull : tk.tierQuick;
  const runButtonLabel = running
    ? showCounter
      ? tk.runningPhase(phaseName, step, EVAL_PHASE_COUNT)
      : phaseName
    : tierName;
  // 选题集跨视图持久（state 在本层），仅题库视图消费，不泄漏到总览/历史。
  const bankSelectionActive = view === "questions" && bankSelectedIds.size > 0;
  const bankQuestionIds = bankSelectionActive
    ? [...bankSelectedIds]
    : undefined;
  // 统一触发入口（2026-09-06 档位单选）：完整档一律收口到确认弹窗（携范围），
  // 快速档直接触发；头部主按钮/chevron 单选/⋯ 菜单/题库右键·行⋮ 全部走这里。
  const requestRun = (layers: "l1" | "l1_l2", questionIds?: string[]) => {
    const scope = questionIds ?? bankQuestionIds;
    if (layers === "l1_l2") {
      setFullRunScope(scope);
      setFullRunOpen(true);
      return;
    }
    handleTrigger(scope ? { layers, question_ids: scope } : { layers });
  };

  return (
    // 滚动模型（对齐 document-panel 头部行 + 内容表格 min-w 的同构做法）：工具栏
    // 固定全宽永不横滚（挤压走 tier 降档）；内容区独立纵向滚动；横向下限沉进
    // 总览两卡各自内部（2026-09-05 每卡独立滑块）——「谁有下限，谁自己滚」。
    <div className="flex h-full min-h-0 flex-col" data-testid="eval-tab">
      {/* 常驻工具栏（§5）：三视图共享，主动词恒可达；tier 1 时状态文案让位；
            底边不画线（2026-09-02，与文档 tab 对齐）：表头自带吸顶发丝线，
            两条线夹表头的问题同款修复，靠留白分界。relative（2026-09-06
            run-progress）：为底缘运行进度细线提供定位上下文，tier0/tier1 共用。 */}
      <div
        ref={viewToolbarRef}
        className="relative flex shrink-0 items-center gap-2 overflow-hidden px-4 py-2 whitespace-nowrap"
        data-testid="eval-view-toolbar"
      >
        <div
          aria-label={tk.viewSwitchLabel}
          className="bg-muted flex shrink-0 rounded-md p-0.5"
          role="radiogroup"
        >
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
          <div className="relative ml-auto w-full max-w-64 min-w-40 shrink">
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
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            view !== "questions" && "ml-auto",
          )}
        >
          {viewToolbarTier === 0 ? (
            // 紧凑档：全栏按钮锁 h-7（2026-08-29 定案：行高 44 = 文档工具栏基准，
            // 原 h-6 降档已回退）；锁运行前后高度恒定不跳动；造题入口已收进档位
            // 下拉（2026-09-06），工具栏仅余分体按钮，主动词恒最右主位。
            <>
              {/* 三按钮统一紧凑档（2026-08-30）：gap-1.5 + px-2.5（vector-tab chips 同款
                    收窄，同内边距不跳宽）；不降字号，保住主动词视觉权重。 */}
              {/* 分体按钮（2026-09-01 B 方案）：主键一键 L1 快速档（高频习惯不变），
                    右侧箭头下拉选完整评测（确认对话框）；两段视觉拼成一枚按钮，
                    锁 h-7 同档；降档时两段一并收进 ⋯ 菜单。 */}
              <div className="flex shrink-0 items-stretch">
                <Button
                  className="h-7 shrink-0 gap-1.5 rounded-r-none px-2.5 tabular-nums has-[>svg]:px-2.5"
                  disabled={running}
                  onClick={() => requestRun(tier)}
                >
                  {running ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <Play aria-hidden className="size-3.5" />
                  )}
                  {runButtonLabel}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={tk.fullRun.menuAria}
                      className="border-primary-foreground/25 h-7 shrink-0 rounded-l-none border-l px-1 has-[>svg]:px-1"
                      disabled={running}
                    >
                      <ChevronDown aria-hidden className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* min-w-0（2026-09-06）：覆盖 ui 默认 min-w-[8rem]，菜单宽度贴合
                      内容（4 字档位名/造题入口），不再比窄触发按钮宽出一截。 */}
                  <DropdownMenuContent align="end" className="min-w-0">
                    {/* 档位互斥单选（2026-09-06）：点选只勾选不运行，主按钮执行勾中
                          档；图标语汇与题库行三点/右键菜单一致（Play/Layers），勾中
                          项尾置 Check 表征单选态。 */}
                    <DropdownMenuItem onClick={() => setTier("l1")}>
                      <Play className="size-4" />
                      {tk.tierQuick}
                      {tier === "l1" && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTier("l1_l2")}>
                      <Layers className="size-4" />
                      {tk.tierFull}
                      {tier === "l1_l2" && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                    {/* 造题入口收进下拉（2026-09-06）：分割线与档位单选隔离；仅题库
                          视图出现（总览/历史无造题语义）。 */}
                    {view === "questions" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setBankAddOpen(true)}>
                          <Plus className="size-4" />
                          {tk.questions.addQuestion}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setBankSynthesisOpen(true)}
                        >
                          <Sparkles className="size-4" />
                          {tk.synthesize.entryButton}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* size-7（28px）与内联按钮 h-7 同高——size=sm（h-8=32px）会把降档后的
                      工具栏撑高 4px（2026-08-30 切题库栏高突跳根因，document-panel 同款先例）。 */}
                <Button
                  aria-label={tk.moreOptions}
                  className="size-7"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* 降档不丢图标（2026-09-02）：⋯ 菜单逐项沿用内联按钮/行级菜单
                      的同一图标（Plus/Sparkles/Play/Layers），两处入口视觉一致。 */}
                {view === "questions" && (
                  <>
                    <DropdownMenuItem onClick={() => setBankAddOpen(true)}>
                      <Plus className="size-4" />
                      {tk.questions.addQuestion}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setBankSynthesisOpen(true)}
                    >
                      <Sparkles className="size-4" />
                      {tk.synthesize.entryButton}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  disabled={running}
                  onClick={() => requestRun("l1")}
                >
                  {running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {tk.tierQuick}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={running}
                  onClick={() => requestRun("l1_l2")}
                >
                  <Layers className="size-4" />
                  {tk.tierFull}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 内容区：百科 Tab 容器同款 overlay 滚动条（2026-09-04）：ScrollArea type="scroll"
            只滚动时浮现、停 2s 淡出、不占布局宽度；horizontal 一并接管题库表格/总览块
            的横滚（吸顶表头的滚动祖先变为 Viewport，sticky 行为同原生容器）。题库视图
            通栏：水平拉满且顶边无内距，表头紧贴工具栏下沿；总览/历史保持 px-4 py-3。 */}
      <ScrollArea
        className={cn(
          "min-h-0 flex-1",
          view === "questions" ? "px-0 pt-0 pb-3" : "px-4 py-3",
        )}
        data-testid="eval-view-content"
        horizontal
        scrollHideDelay={2000}
        type="scroll"
      >
        <div className="flex min-w-0 flex-col gap-4">
          {view === "overview" && (
            <>
              {/* 运行进度容器（spec 2026-09-06 §9）：仅总览、仅运行中，检索质量卡上方。
                  题库/历史视图不渲染——那里由工具栏按钮的 4 字阶段名承载紧凑表面。 */}
              {running && <EvalRunBanner progress={progress} tier={bannerTier} />}

              {/* 指标总览块（2026-09-05 三迭代）：横向滑块与 min-w 下限沉进
                  overview 两张卡各自内部——每卡独立横滚，不再共用总览块一个
                  滑块；本层 ScrollArea 只承纵向与题库/历史的横滚。 */}
              <ScrollArea
                className="min-w-0"
                data-testid="eval-overview-scroll"
                horizontal
                scrollHideDelay={2000}
                type="scroll"
              >
                <div className="min-w-0">
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
              </ScrollArea>

              {/* 趋势图卡片壳（2026-09-05 容器化）：项目面板配方 bg-card + border +
                  shadow-xs + 卡内头部行（border-b）——与总览两卡/检索测试容器同词汇；
                  粒度切换 + 阈值红芯片都在头部行（阈值标注从线上文字退役——压数据线）。 */}
              <section className="bg-card text-card-foreground overflow-hidden rounded-lg border shadow-xs">
                <div
                  ref={toolbarRef}
                  className={cn(
                    "flex items-center gap-2 overflow-hidden px-4 py-2.5 whitespace-nowrap",
                    !trendCollapsed && "border-b",
                  )}
                  data-testid="eval-trend-toolbar"
                >
                  <button
                    aria-expanded={!trendCollapsed}
                    className="hover:bg-muted/50 flex min-w-0 items-center gap-2 rounded-md px-2 py-0.5 text-left text-sm font-semibold transition-colors"
                    data-testid="eval-trend-toggle"
                    type="button"
                    onClick={() => setTrendCollapsed((v) => !v)}
                  >
                    <TrendingUp className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="whitespace-nowrap shrink-0">{tk.trendTitle}</span>
                  </button>
                  {trendQuery.data?.baseline && (
                    <Badge
                      className="shrink-0 tabular-nums"
                      data-testid="eval-threshold-chip"
                      variant="destructive"
                    >
                      {tk.trend.thresholdLabel(trendQuery.data.baseline.threshold_percent)}
                    </Badge>
                  )}
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
                              granularity === g
                                ? "bg-background shadow-sm"
                                : "text-muted-foreground"
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
                          <Button
                            aria-label={tk.moreOptions}
                            className="size-7"
                            size="icon-sm"
                            variant="ghost"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuRadioGroup
                            value={granularity}
                            onValueChange={(value) =>
                              setGranularity(value as Granularity)
                            }
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
                {!trendCollapsed && (
                  <div className="p-4">
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
                      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                        {tk.emptyTrend}
                      </div>
                    )
                  ) : null}
                  </div>
                )}
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
              onTrigger={(input) =>
                requestRun(input.layers ?? "l1", input.question_ids)
              }
            />
          )}

          {view === "history" && (
            /* 历史视图（Task 7）：运行列表行，行点击复用既有 EvalRunDrawer 实例下钻 */
            <EvalRunHistory
              enabled={enabled}
              kbId={kbId}
              onOpenRun={setDrawerRunId}
            />
          )}
        </div>
      </ScrollArea>

      {/* 完整评测确认对话框（2026-09-01 B 方案）：箭头/⋯ 菜单打开，确认后触发
          l1_l2 档；题库视图有选中时携 question_ids（原批量栏的完整运行所选） */}
      <EvalFullRunDialog
        open={fullRunOpen}
        onOpenChange={setFullRunOpen}
        scopeCount={fullRunScope?.length}
        onConfirm={() => {
          handleTrigger(
            fullRunScope
              ? { layers: "l1_l2", question_ids: fullRunScope }
              : { layers: "l1_l2" },
          );
          setFullRunScope(undefined);
        }}
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
