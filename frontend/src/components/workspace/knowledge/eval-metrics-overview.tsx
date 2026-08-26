/**
 * Eval metrics overview component (spec 2026-08-24 §3.3/§3.4, plan Task 2).
 *
 * Props-driven shell: no built-in fetch — overview injected by the parent tab.
 * Color thresholds come from baseline_diff.threshold_percent (CI gate same origin),
 * never hard-coded. Null values render as dash with muted styling.
 */
"use client";

import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { MetricsOverview, BaselineDiff } from "@/core/knowledge/types";

import { classifyRagasSkipReason, getCellColorClass, getProgressBarColor } from "./eval-metrics-overview.utils";

interface EvalMetricsOverviewProps {
  overview: MetricsOverview;
  onViewTrace?: (url: string) => void;
}

/** Format value to percentage (1 decimal place) or return empty if null. */
const percent = (v: number | null): string => (v == null ? "" : `${(v * 100).toFixed(1)}%`);

export function EvalMetricsOverview({ overview, onViewTrace }: EvalMetricsOverviewProps) {
  const { t } = useI18n();
  const tk = t.knowledge.eval;
  const { layer1, layer2 } = overview;

  return (
    <div className="space-y-6">
      {/* Layer 1 表格 */}
      <section>
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <span className="whitespace-nowrap shrink-0">{tk.layer1Title}</span>
          {layer1?.baseline_diff?.regression_detected && (
            <Badge variant="destructive">{tk.regressionBadge}</Badge>
          )}
        </div>
        {layer1 ? (
          <Layer1Table metrics={layer1.metrics} diff={layer1.baseline_diff! as BaselineDiff | undefined} />
        ) : (
          <EmptyHint text={tk.emptyLayer1} />
        )}
      </section>

      {/* Layer 2 卡片 */}
      <section>
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <span data-testid="eval-layer2-title" className="whitespace-nowrap shrink-0">{tk.layer2Title}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="eval-layer2-info"
                aria-label={tk.layer2Note}
                className="inline-flex text-muted-foreground hover:text-foreground"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{tk.layer2Note}</TooltipContent>
          </Tooltip>
          {layer2 && !layer2.ragas_available && (
            classifyRagasSkipReason(layer2.ragas_skip_reason) === "error" ? (
              <span className="ml-auto flex items-center gap-1 shrink-0">
                <Badge variant="secondary" data-testid="eval-ragas-badge">{tk.ragasErrorBadge}</Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="eval-ragas-error-info"
                      aria-label={layer2.ragas_skip_reason}
                      className="inline-flex text-muted-foreground hover:text-foreground"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs whitespace-pre-wrap">{layer2.ragas_skip_reason}</TooltipContent>
                </Tooltip>
              </span>
            ) : (
              <Badge variant="secondary" className="ml-auto" data-testid="eval-ragas-badge">
                {tk.ragasMissingBadge}
              </Badge>
            )
          )}
        </div>
        {layer2 ? (
          <>
            <div className="grid grid-cols-4 gap-4">
              <RagasCard title="Faithfulness" value={layer2.ragas.faithfulness} traceUrl={layer2.langfuse_trace_url} onViewTrace={onViewTrace} traceLabel={tk.viewTrace} testId="faithfulness" />
              <RagasCard title="Answer Relevancy" value={layer2.ragas.answer_relevancy} testId="answer_relevancy" />
              <RagasCard title="Context Precision" value={layer2.ragas.context_precision} testId="context_precision" />
              <RagasCard title="Context Recall" value={layer2.ragas.context_recall} testId="context_recall" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <ArchCard title={tk.citationPrecision} value={layer2.arch_specific.citation_precision} testId="citation_precision" />
              <ArchCard title={tk.citationRecall} value={layer2.arch_specific.citation_recall} testId="citation_recall" />
              <ArchCard
                title={tk.seedHitRate}
                value={layer2.arch_specific.seed_hit_rate}
                disabled={!layer2.has_graph_questions}
                disabledReason={tk.noGraphQuestions}
                testId="seed_hit_rate"
              />
            </div>
          </>
        ) : (
          <EmptyHint text={tk.emptyLayer2} />
        )}
      </section>
    </div>
  );
}

function Layer1Table({ metrics, diff }: { metrics: NonNullable<MetricsOverview["layer1"]>["metrics"]; diff?: NonNullable<NonNullable<MetricsOverview["layer1"]>>["baseline_diff"] }) {
  const { t } = useI18n();
  const tk = t.knowledge.eval;
  // Category order matches wire keys; categories missing from by_category are skipped.
  const categories: Array<keyof typeof metrics | "summary"> = ["fact", "relation", "concept", "global", "summary"];

  /** Tint Recall@k cells per §3.3: delta >= 0 → default；warning band；danger at threshold. */
  const tint = getCellColorClass(diff?.recall_at_k_delta, diff?.threshold_percent);

  return (
    <Table data-testid="eval-layer1-table">
      <TableHeader>
        <TableRow>
          <TableHead>{tk.tableCategory}</TableHead>
          <TableHead>{tk.tableHitRate}</TableHead>
          <TableHead>{tk.tableRecallAtK}</TableHead>
          <TableHead>{tk.tableMrr}</TableHead>
          <TableHead>{tk.tablePathAccuracy}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category, _) => {
          const metric =
            category === "summary" ? metrics.summary : metrics[category] ?? null;
          const hasData = !!metric;
          const testId = category === "summary" ? "eval-row-summary" : `eval-row-${category}`;

          // Muted row for missing category (category not present in this batch).
          if (!hasData) {
            return (
              <TableRow key={category} data-testid={testId} className="text-muted-foreground">
                <TableCell colSpan={5}>{tk.category[category]} ({tk.noQuestionsInBatch})</TableCell>
              </TableRow>
            );
          }

          // Summary row styled with border-top.
          const summaryRowClassName = category === "summary" ? "border-t-2 font-semibold" : undefined;

          return (
            <TableRow key={category} data-testid={testId} className={summaryRowClassName}>
              <TableCell>{category === "summary" ? tk.category.summary : `${tk.category[category]} (n=${metric.question_count})`}</TableCell>
            <TableCell data-testid={`eval-cell-hit-${category}`}>{percent(metric.hit_rate)}</TableCell>
              <TableCell data-testid={`eval-cell-recall-${category}`} className={tint}>{percent(metric.recall_at_k)}</TableCell>
              <TableCell data-testid={`eval-cell-mrr-${category}`}>{metric.mrr.toFixed(3)}</TableCell>
              <TableCell data-testid={`eval-cell-path-${category}`}>{percent(metric.path_accuracy)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RagasCard({ title, value, traceUrl, onViewTrace, traceLabel, testId }: { title: string; value: number | null; traceUrl?: string; onViewTrace?: (url: string) => void; traceLabel?: string; testId: string }) {
  const colorClass = getProgressBarColor(value);
  const isNull = value == null;
  return (
    <Card data-testid={`eval-card-${testId}`} className={isNull ? "bg-muted" : ""}>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-bold">
          {isNull ? "-" : value.toFixed(3)}
        </div>
        {!isNull && (
          <>
            <Progress value={value * 100} className={colorClass} />
            <div className="text-sm text-muted-foreground">{percent(value)}</div>
          </>
        )}
      </CardContent>
      {/* Langfuse trace link only on first card (faithfulness) — align with spec §3.7示意. */}
      {title === "Faithfulness" && traceUrl && traceLabel && onViewTrace && (
        <CardContent>
          <button role="button" onClick={() => onViewTrace(traceUrl)}>{traceLabel}</button>
        </CardContent>
      )}
    </Card>
  );
}

function ArchCard({ title, value, disabled, disabledReason, testId }: { title: string; value: number | null; disabled?: boolean; disabledReason?: string; testId: string }) {
  const colorClass = getProgressBarColor(value);
  const isNull = value == null;

  // Disabled state: bg-muted + reason note below progress bar.
  const baseClassName = disabled || isNull ? "bg-muted" : "";

  return (
    <Card data-testid={`eval-card-${testId}`} className={baseClassName}>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-bold">{isNull ? "-" : value.toFixed(3)}</div>
        {!isNull && (
          <>
            <Progress value={value * 100} className={colorClass} />
            <div className="text-sm text-muted-foreground">{percent(value)}</div>
          </>
        )}
        {disabled && disabledReason && <div className="text-xs text-muted-foreground">{disabledReason}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
