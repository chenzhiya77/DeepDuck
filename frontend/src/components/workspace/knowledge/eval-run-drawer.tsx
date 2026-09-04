"use client";

/**
 * 单次评测运行详情 drawer 壳（2026-08-24 spec §5，plan Task 6）：趋势图数据点
 * 点击下钻。只读摘要：run 元信息（run_id / 运行时间 / 环境 / 状态 / 基线徽标）
 * + 两层指标；Layer 2 的 path_accuracy（真实对话链路选路准确率）与 Layer 1
 * 同名指标口径不同，仅在 drawer 展示并标注口径——spec §5 冻结契约。
 * 逐题明细 UI 另立 spec。层未执行（*_metrics 为 {}）渲染「未执行」提示。
 * 对齐 ChunkDrawer 的 Sheet 模式；不跳路由（知识库页无 kb 子路由）。
 */
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useEvalRun } from "@/core/knowledge/hooks";
import type {
  EvalRunDetail,
  Layer1Metrics,
  RagasMetrics,
} from "@/core/knowledge/types";

/** 率类指标百分比（1 位小数）；MRR/RAGAS 原始三位小数（对齐总览/趋势口径）。 */
const percent = (v: number): string => `${(v * 100).toFixed(1)}%`;
const raw3 = (v: number | null): string => (v == null ? "-" : v.toFixed(3));

function isLayer1Metrics(
  m: EvalRunDetail["layer1_metrics"],
): m is Layer1Metrics {
  return "summary" in m;
}

function isLayer2Metrics(
  m: EvalRunDetail["layer2_metrics"],
): m is Extract<EvalRunDetail["layer2_metrics"], { ragas: RagasMetrics }> {
  return "ragas" in m;
}

export function EvalRunDrawer({
  kbId,
  runId,
  open,
  onOpenChange,
}: {
  kbId: string;
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const te = t.knowledge.eval;
  const td = te.drawer;
  // 关闭态不残留请求：runId 置 null 即禁用查询（useEvalRun 门控）。
  const query = useEvalRun(kbId, open ? runId : null);
  const run = query.data;

  if (!runId) return null;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-hidden sm:max-w-xl" side="right">
        {/* 百科 Tab 容器同款 overlay 滚动条（2026-09-04）：整抽屉经 ScrollArea 滚动
            （type="scroll"、停 2s 淡出、不占宽），取代 SheetContent 原生 overflow-y-auto；
            × 关闭钮由随内容滚改为钉住。 */}
        <ScrollArea
          className="min-h-0 flex-1"
          scrollHideDelay={2000}
          type="scroll"
        >
          <SheetHeader>
            <SheetTitle>{td.title}</SheetTitle>
          </SheetHeader>
          {/* mt-4 补原 SheetContent flex gap-4 的头部间距（header p-4 底 16 + 16 = 32 不变） */}
          <div className="mt-4 flex flex-col gap-4 px-4 pb-6">
            {query.isLoading && (
              <p className="text-muted-foreground py-4 text-center text-sm">
                {te.loading}
              </p>
            )}
            {query.error && (
              <p className="text-destructive py-4 text-center text-sm">
                {te.loadFailed}
              </p>
            )}
            {run && (
              <>
                {/* 运行元信息 */}
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">{td.runIdLabel}</dt>
                  <dd className="font-mono text-xs break-all">{run.run_id}</dd>
                  <dt className="text-muted-foreground">{td.createdAtLabel}</dt>
                  <dd>{new Date(run.created_at).toLocaleString()}</dd>
                  <dt className="text-muted-foreground">
                    {td.environmentLabel}
                  </dt>
                  <dd>{run.environment}</dd>
                  <dt className="text-muted-foreground">{td.statusLabel}</dt>
                  <dd className="flex items-center gap-2">
                    <Badge
                      variant={
                        run.status === "completed" ? "secondary" : "destructive"
                      }
                    >
                      {run.status === "completed"
                        ? td.statusCompleted
                        : run.status === "error"
                          ? td.statusError
                          : td.statusSkipped}
                    </Badge>
                    {run.is_baseline && (
                      <Badge variant="outline">{td.baselineBadge}</Badge>
                    )}
                  </dd>
                </dl>

                {/* Layer 1 · 检索指标（summary 摘要级） */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    {td.layer1Section}
                  </h3>
                  {isLayer1Metrics(run.layer1_metrics) ? (
                    <MetricList
                      rows={[
                        [
                          te.tableHitRate,
                          percent(run.layer1_metrics.summary.hit_rate),
                        ],
                        [
                          te.tableRecallAtK,
                          percent(run.layer1_metrics.summary.recall_at_k),
                        ],
                        [te.tableMrr, raw3(run.layer1_metrics.summary.mrr)],
                        [
                          te.tablePathAccuracy,
                          percent(run.layer1_metrics.summary.path_accuracy),
                        ],
                      ]}
                      footer={`${te.tableCategory}: ${run.layer1_metrics.summary.question_count}`}
                    />
                  ) : (
                    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                      {td.notRun}
                    </p>
                  )}
                </section>

                {/* Layer 2 · 生成质量（含 path_accuracy 口径标注） */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    {td.layer2Section}
                  </h3>
                  {isLayer2Metrics(run.layer2_metrics) ? (
                    <div>
                      <MetricList
                        rows={[
                          [
                            te.trend.faithfulness,
                            raw3(run.layer2_metrics.ragas.faithfulness),
                          ],
                          [
                            te.trend.answerRelevancy,
                            raw3(run.layer2_metrics.ragas.answer_relevancy),
                          ],
                          [
                            te.trend.contextPrecision,
                            raw3(run.layer2_metrics.ragas.context_precision),
                          ],
                          [
                            td.contextRecallLabel,
                            raw3(run.layer2_metrics.ragas.context_recall),
                          ],
                          [
                            te.citationPrecision,
                            raw3(
                              run.layer2_metrics.arch_specific
                                .citation_precision,
                            ),
                          ],
                          [
                            te.citationRecall,
                            raw3(
                              run.layer2_metrics.arch_specific.citation_recall,
                            ),
                          ],
                          [
                            te.seedHitRate,
                            raw3(
                              run.layer2_metrics.arch_specific.seed_hit_rate,
                            ),
                          ],
                          [
                            td.pathAccuracyLabel,
                            run.layer2_metrics.path_accuracy == null
                              ? "-"
                              : percent(run.layer2_metrics.path_accuracy),
                          ],
                        ]}
                        footer={
                          run.layer2_metrics.has_graph_questions
                            ? undefined
                            : te.noGraphQuestions
                        }
                      />
                      <p className="text-muted-foreground mt-2 text-xs">
                        {td.pathAccuracyNote}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                      {td.notRun}
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function MetricList({
  rows,
  footer,
}: {
  rows: Array<[string, string]>;
  footer?: string;
}) {
  return (
    <dl className="rounded-lg border">
      {rows.map(([label, value]) => (
        <div
          className="flex items-center justify-between gap-4 border-b px-3 py-1.5 last:border-b-0"
          key={label}
        >
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="font-mono text-xs">{value}</dd>
        </div>
      ))}
      {footer && (
        <div className="text-muted-foreground px-3 py-1.5 text-xs">
          {footer}
        </div>
      )}
    </dl>
  );
}
