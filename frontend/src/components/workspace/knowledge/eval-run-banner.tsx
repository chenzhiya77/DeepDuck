"use client";

/**
 * 运行进度容器（spec 2026-09-06 §9）：取代工具栏底缘细线（那条只表征 questions
 * 段，是用户口中的"假进度条"）。
 *
 * - 第一行 = **单轨时长加权整体条**：一条轨道内按各段预计时长占比划跨度（短段窄、
 *   长段宽），段边界画刻线、当前段跨度提亮、填充连续跨过边界——不做单一 0-100%
 *   假百分比，几何由 `adaptiveWeights`（先验 + 本 run 实测自适应）给出。右侧**只放
 *   ETA**，warmup 不足时显示「估算中…」而不是撒谎。
 * - 第二行 = **单行实时日志**：后端结构化 `tail` 事件在此按 locale 渲染（后端不出
 *   文案），新事件以 key 变化触发一次淡入替换，`aria-live=polite` 让读屏跟上。
 *
 * 挂载点在总览视图检索质量卡上方（Task 12），仅运行中渲染；题库/历史仍由工具栏
 * 按钮的 4 字阶段名承载紧凑表面。
 */
import { useI18n } from "@/core/i18n/hooks";
import {
  EVAL_PHASE_ORDER,
  adaptiveWeights,
  etaMinutes,
  etaSeconds,
  overallFraction,
  type EvalPhaseWeights,
  type EvalTier,
} from "@/core/knowledge/eval-run-status";
import type { EvalRunProgress } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

export interface EvalRunBannerProps {
  /** 活进度快照；触发瞬间的乐观窗口为 null（渲染空条 + 等待行）。 */
  progress: EvalRunProgress | null;
  /** 档位决定流水线段数：快速档只有检索一段（无刻线）。 */
  tier: EvalTier;
  className?: string;
}

type EvalPhase = EvalRunProgress["phase"];

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function EvalRunBanner({ progress, tier, className }: EvalRunBannerProps) {
  const { t } = useI18n();
  const tk = t.knowledge.eval;

  const phases: EvalPhase[] = tier === "l1" ? EVAL_PHASE_ORDER.slice(0, 1) : EVAL_PHASE_ORDER;
  const weights: EvalPhaseWeights = adaptiveWeights(progress, tier);
  const fraction = overallFraction(progress, tier);
  const etaSecs = etaSeconds(progress, tier);
  // 不足一分钟用秒：分钟粒度（下限 1）会把几秒的剩余说成"~1 分钟"而撒谎。
  const etaText =
    etaSecs === null
      ? tk.etaEstimating
      : etaSecs < 60
        ? tk.etaRemainingSeconds(Math.max(1, Math.round(etaSecs)))
        : tk.etaRemaining(etaMinutes(etaSecs) ?? 1);
  const current: EvalPhase = progress && phases.includes(progress.phase) ? progress.phase : (phases[0] ?? "layer1");

  const phaseWord = (phase: EvalPhase) => (phase === "layer1" ? tk.phaseLayer1 : phase === "ragas" ? tk.phaseRagas : tk.phaseQuestions);

  // 段跨度几何：刻线画在每段结束处（末段终点即条尾，不画线）；当前段跨度 = 起点 + 权重。
  const boundaries: number[] = [];
  let cursor = 0;
  let spanStart = 0;
  for (const [index, phase] of phases.entries()) {
    if (phase === current) spanStart = cursor;
    cursor += weights[phase] ?? 0;
    if (index < phases.length - 1) boundaries.push(cursor);
  }

  const tail = progress?.tail ?? null;
  const logText = !tail
    ? tk.logWaiting
    : tail.kind === "phase"
      ? tk.logPhase(phaseWord(tail.phase))
      : tail.kind === "fail"
        ? tk.logFail(phaseWord(tail.phase), tail.done, tail.total, tail.failed)
        : tk.logItem(phaseWord(tail.phase), tail.done, tail.total);
  // key 变化触发一次淡入：单行日志的"滚动显示" = 新事件替换旧事件。
  const logKey = tail ? `${tail.kind}:${tail.phase}:${tail.done}:${tail.failed}` : "waiting";

  return (
    <div className={cn("bg-card space-y-2 rounded-lg border px-3 py-2.5", className)} data-testid="eval-run-banner">
      <div className="flex items-center gap-3">
        <div
          aria-label={tk.bannerAria(phaseWord(current), Math.round(fraction * 100))}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(fraction * 100)}
          className="bg-muted relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          data-testid="eval-run-bar"
          role="progressbar"
        >
          <div
            className="bg-primary/15 absolute inset-y-0 transition-all duration-500"
            data-testid="eval-banner-span"
            style={{ left: percent(spanStart), width: percent(weights[current] ?? 0) }}
          />
          <div
            className="bg-primary absolute inset-y-0 left-0 transition-[width] duration-500"
            data-testid="eval-banner-fill"
            style={{ width: percent(fraction) }}
          />
          {boundaries.map((boundary) => (
            <div
              className="bg-card absolute inset-y-0 w-px opacity-70"
              data-testid="eval-banner-tick"
              key={boundary}
              style={{ left: percent(boundary) }}
            />
          ))}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums" data-testid="eval-banner-eta">
          {etaText}
        </span>
      </div>
      <div
        aria-live="polite"
        className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs"
        data-testid="eval-banner-log"
      >
        <span className="animate-in fade-in-0 slide-in-from-bottom-0.5 truncate duration-300" key={logKey}>
          {logText}
        </span>
        {progress && progress.failed > 0 && (
          <span
            className="bg-destructive/10 text-destructive shrink-0 rounded px-1.5 text-[11px] tabular-nums"
            data-testid="eval-banner-failed"
          >
            {tk.failedCount(progress.failed)}
          </span>
        )}
      </div>
    </div>
  );
}
