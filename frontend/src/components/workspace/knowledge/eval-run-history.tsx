"use client";

/**
 * 历史视图（2026-08-27 spec §6.2，plan Task 7）：运行列表——⭐baseline 标记
 * + 时间 + 环境 Badge + 层徽标 + 状态短文案 + 回退红 Badge。行点击经
 * ``onOpenRun`` 复用 eval-tab 持有的 EvalRunDrawer 实例（与趋势图点数据点
 * 同一下钻出口，零新 drawer）。skipped/error 行不进 latest/trend——历史是
 * 它们的唯一曝光面；in-flight 运行不产生伪行（运行中状态只由工具栏 spinner
 * 表达，行在落库后才出现）。
 */
import { Ban, CheckCircle2, SkipForward, Star, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/core/i18n/hooks";
import { useEvalRuns } from "@/core/knowledge/hooks";
import type { EvalRunSummary } from "@/core/knowledge/types";

export interface EvalRunHistoryProps {
  kbId: string;
  /** keep-alive 懒门控（eval tab 激活才发请求；与工具栏共享同一 query 缓存）。 */
  enabled?: boolean;
  /** 行点击下钻：携带 runId，由 eval-tab 的 setDrawerRunId 承接。 */
  onOpenRun: (runId: string) => void;
}

/** 行内时间：MM-DD HH:mm（spec §6.2 ASCII 示例口径）；缺失/非法 → "-"。 */
export function formatRunTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EvalRunHistory({ kbId, enabled = true, onOpenRun }: EvalRunHistoryProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const htk = etk.history;
  const query = useEvalRuns(kbId, enabled);

  const envLabel = (run: EvalRunSummary) =>
    run.environment === "ci" ? htk.envCi : run.environment === "nightly" ? htk.envNightly : htk.envLocal;
  const layerBadge = (run: EvalRunSummary) =>
    run.has_layer1 && run.has_layer2 ? "L1+L2" : run.has_layer1 ? "L1" : run.has_layer2 ? "L2" : "-";

  const renderStatus = (run: EvalRunSummary) => {
    if (run.status === "error") {
      return (
        <>
          <XCircle aria-hidden className="text-destructive size-3.5 shrink-0" />
          {htk.statusError}
        </>
      );
    }
    if (run.status === "skipped") {
      return (
        <>
          <SkipForward aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
          {htk.statusSkipped}
        </>
      );
    }
    // 终止行（spec 2026-09-06 §11）：用户主动行为，muted 色调区别 error 的红。
    if (run.status === "cancelled") {
      return (
        <>
          <Ban aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
          {htk.statusCancelled}
        </>
      );
    }
    return (
      <>
        <CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
        {htk.statusCompleted}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {query.isLoading ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loading}
        </div>
      ) : query.error ? (
        <div className="text-destructive rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loadFailed}
        </div>
      ) : query.data && query.data.runs.length > 0 ? (
        <div className="flex flex-col">
          {query.data.runs.map((run) => (
            <button
              key={run.run_id}
              className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
              type="button"
              onClick={() => onOpenRun(run.run_id)}
            >
              {run.is_baseline && (
                <Star aria-hidden className="fill-current size-3.5 shrink-0" data-testid="eval-run-baseline-star" />
              )}
              <span className="text-muted-foreground w-24 shrink-0 font-mono text-xs">
                {formatRunTime(run.created_at)}
              </span>
              <Badge className="shrink-0" variant="outline">
                {envLabel(run)}
              </Badge>
              <Badge className="shrink-0" variant="secondary">
                {layerBadge(run)}
              </Badge>
              <span className="flex items-center gap-1 text-xs">{renderStatus(run)}</span>
              {run.regression_detected && (
                <Badge className="shrink-0" variant="destructive">
                  {etk.regressionBadge}
                </Badge>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {htk.emptyHistory}
        </div>
      )}
    </div>
  );
}
