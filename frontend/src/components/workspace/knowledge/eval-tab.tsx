"use client";

/**
 * 评测 tab（2026-08-24 spec §5，plan Task 4）：单列垂直布局（2026-08-26 布局
 * 定案 route A；双栏工作台依赖父 spec §9 二期 API，另立 plan）——
 * 上：运行配置区一行说明文案（§9 触发按钮落地前不留无功能空盒）；
 * 中：指标总览（eval-metrics-overview，props 驱动）；
 * 下：趋势图卡片壳（eval-trend-chart 经 next/dynamic ssr:false 懒加载，
 *     粒度按钮组接 useToolbarTier 窄面板降档——vector-tab 溢出检测先例）+
 *     drawer 占位（Task 6 落地 EvalRunDrawer）。
 * 数据接线（TanStack Query hooks + enabled 门控）在 Task 5，本组件保持
 * props 驱动、不内置 fetch。
 */
import { MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import type {
  MetricsOverview,
  TrendChartLabels,
  TrendQueryParams,
  TrendResponse,
} from "@/core/knowledge/types";

import { EvalMetricsOverview } from "./eval-metrics-overview";
import type { EvalTrendChartProps } from "./eval-trend-chart";

const EvalTrendChart = dynamic<EvalTrendChartProps>(() => import("./eval-trend-chart"), {
  ssr: false,
});

type Granularity = TrendQueryParams["granularity"];

/** 档级：0=粒度按钮组内联 1=收进 ⋯ 菜单（趋势卡片壳工具栏只有一组控件，两档够用）。 */
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

const GRANULARITIES = ["day", "week", "month"] as const;

export interface EvalTabProps {
  /** 指标总览数据（Task 5 由 useMetricsOverview 注入；null = 尚未加载）。 */
  overview: MetricsOverview | null;
  /** 趋势数据（Task 5 由 useEvalTrend 注入；null = 尚未加载/查询未启用）。 */
  trend: TrendResponse | null;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
}

export function EvalTab({ overview, trend, granularity, onGranularityChange }: EvalTabProps) {
  const { t } = useI18n();
  const tk = t.knowledge.eval;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarTier = useToolbarTier(toolbarRef);
  // drawer 占位状态（Task 6 落地 EvalRunDrawer，此处仅记录点击来源 runId）。
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 py-3" data-testid="eval-tab">
      {/* 运行配置区：父 spec §9 触发按钮落地前仅渲染一行说明文案，不留空盒 */}
      <p className="text-muted-foreground text-xs">{tk.runConfigNote}</p>

      {/* 指标总览（Layer 1 表格 + Layer 2 卡片） */}
      {overview ? <EvalMetricsOverview overview={overview} /> : null}

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
                    onClick={() => onGranularityChange(g)}
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
                    onValueChange={(value) => onGranularityChange(value as Granularity)}
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
        {trend ? (
          <EvalTrendChart
            baseline={trend.baseline}
            granularity={trend.granularity}
            labels={chartLabels}
            points={trend.points}
            onPointClick={setDrawerRunId}
          />
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {tk.emptyTrend}
          </div>
        )}
      </section>

      {/* drawer 占位：Task 6 落地 EvalRunDrawer 后替换 */}
      {drawerRunId ? (
        <div className="hidden" data-testid="eval-run-drawer-placeholder">
          {drawerRunId}
        </div>
      ) : null}
    </div>
  );
}
