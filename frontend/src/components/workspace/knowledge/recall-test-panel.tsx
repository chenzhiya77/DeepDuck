"use client";

import { ChevronDown, ChevronRight, FlaskConical, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { useRecallTest } from "@/core/knowledge/hooks";
import type {
  RecallGraphEvidence,
  RecallPathName,
  RecallTestResponse,
  RecallVectorHit,
  RecallWikiHit,
  VectorRetrievalOverlay,
} from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { ChunkCard } from "./chunk-card";
import { EvalSaveQuestionDialog } from "./eval-save-question-dialog";


function formatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(3);
}

function PathHeader({
  name,
  scoreType,
  elapsedMs,
  message,
}: {
  name: string;
  scoreType: string;
  elapsedMs: number;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{name}</span>
        <Badge className="text-[10px]" variant="outline">
          {scoreType}
        </Badge>
        <span className="text-muted-foreground text-xs">{elapsedMs} ms</span>
      </div>
      <p className="text-muted-foreground text-xs">{message}</p>
    </div>
  );
}

/** Collapsible chunk hit (vector path / graph evidence) → shared ChunkCard.
 *
 * checked/onCheckChange 挂「存为考题」勾选（spec §7.1）——checkbox 与展开 button 并列（button 不能嵌套）。
 */
function ChunkHitRow({
  hit,
  score,
  testId,
  kbId,
  expanded,
  onToggle,
  checked,
  onCheckChange,
  selectLabel,
  selectTestId,
}: {
  hit: { chunk_id: string; doc_name: string; text: string; heading_path: string[]; page: number | null; rank?: number };
  score: number | null;
  testId: string;
  /** Enables in-place chunk images (`images/…` → document files route). */
  kbId: string;
  expanded: boolean;
  onToggle: () => void;
  checked: boolean;
  onCheckChange: () => void;
  /** 勾选框 aria-label（调用点用 i18n 组装——模块级组件拿不到 tr）。 */
  selectLabel: string;
  /** 勾选框 testid：带路径前缀——同一 chunk 可能同时命中两路。 */
  selectTestId: string;
}) {
  // chunk_id 形如 `{doc_id}#0001`（chunker 生成），前段即 doc_id。
  const docId = hit.chunk_id.split("#")[0]!;
  return (
    <div className="flex items-start gap-1.5">
      <Checkbox
        aria-label={selectLabel}
        checked={checked}
        className="mt-2 shrink-0"
        data-testid={selectTestId}
        onCheckedChange={onCheckChange}
      />
      <div className="min-w-0 flex-1">
      <button
        className="hover:bg-muted/50 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm"
        data-testid={testId}
        type="button"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="text-muted-foreground size-3.5 shrink-0" /> : <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
        {hit.rank != null && <span className="text-muted-foreground shrink-0 text-xs">#{hit.rank}</span>}
        <span className="min-w-0 truncate font-medium">{hit.doc_name}</span>
        {hit.page != null && <span className="text-muted-foreground shrink-0 text-xs">p.{hit.page}</span>}
        <span className="text-muted-foreground ml-auto shrink-0 font-mono text-xs">{formatScore(score)}</span>
      </button>
      {expanded && (
        <ChunkCard docId={docId} docName={hit.doc_name} headingPath={hit.heading_path} kbId={kbId} page={hit.page} text={hit.text} />
      )}
      </div>
    </div>
  );
}

/**
 * P1 检索测试 tab (phase-2 batch-1, spec §3): fan one query out to the three
 * retrieval paths and compare hits/scores/elapsed side by side. Vector/graph
 * hits expand into the shared ChunkCard; wiki hits open the entry drawer via
 * ``onOpenWikiEntry`` (overlay — never switches the middle tab). Keep-alive:
 * the pane stays mounted, so the last result survives tab switches.
 */
export function RecallTestPanel({
  kbId,
  onOpenWikiEntry,
  onOpenManualCard,
  onViewInVectorSpace,
  prefillQuery,
  onPrefillConsumed,
}: {
  kbId: string;
  onOpenWikiEntry: (entryId: string) => void;
  /** Phase-3 P6（spec §8 混排）：manual 命中开卡片抽屉 —— 卡片 id 走 wiki 详情接口必然 404。 */
  onOpenManualCard?: (cardId: string) => void;
  /**
   * P6 检索联动（2026-08-15 spec §9 通道一）：结果区「在向量空间查看」——
   * page 层切 tab 并完成叠加（query 落点 + vector 路命中高亮）。
   */
  onViewInVectorSpace?: (overlay: VectorRetrievalOverlay) => void;
  /** 复现通道（§7.2）：评测侧跳转携带的预填 query；消费后回调清空。 */
  prefillQuery?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const { t } = useI18n();
  const tr = t.knowledge.recallTest;
  const recallTest = useRecallTest(kbId);
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const result: RecallTestResponse | null = recallTest.data ?? null;

  // 复现预填通道（§7.2）：写入输入框即消费——只预填，不替用户发起检索。
  useEffect(() => {
    if (prefillQuery) {
      setQuery(prefillQuery);
      onPrefillConsumed?.();
    }
  }, [prefillQuery, onPrefillConsumed]);

  // 「存为考题」勾选（§7.1）：vector 命中 + graph 证据按 chunk id 去重，
  // 百科词条行（2026-08-28 §5）按其源切片整体进/出锚定集；记录来源路径供
  // dialog 默认预期路径（多路化：混路即多勾）。
  const [selectedChunks, setSelectedChunks] = useState<{ id: string; path: RecallPathName }[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const toggleChunk = (chunkId: string, path: "vector" | "graph") =>
    setSelectedChunks((current) =>
      current.some((item) => item.id === chunkId)
        ? current.filter((item) => item.id !== chunkId)
        : [...current, { id: chunkId, path }],
    );
  const wikiEntryChecked = (hit: RecallWikiHit) => {
    const sourceIds = hit.source_chunk_ids ?? [];
    if (sourceIds.length === 0) return false;
    const selected = new Set(selectedChunks.map((item) => item.id));
    return sourceIds.every((id) => selected.has(id));
  };
  // 词条行勾选 = 源切片整体进锚定集（已选的切片不重复加，保提交体无重）。
  const toggleWikiEntry = (hit: RecallWikiHit) => {
    const sourceIds = hit.source_chunk_ids ?? [];
    if (sourceIds.length === 0) return;
    setSelectedChunks((current) => {
      const selected = new Set(current.map((item) => item.id));
      if (sourceIds.every((id) => selected.has(id))) {
        return current.filter((item) => !sourceIds.includes(item.id));
      }
      const additions = sourceIds.filter((id) => !selected.has(id)).map((id) => ({ id, path: "wiki" as const }));
      return [...current, ...additions];
    });
  };
  const selectionPaths = new Set(selectedChunks.map((item) => item.path));
  // 默认勾选 = 来源路径集合（2026-08-28 多路化）：混路即多勾，不再降级单路；
  // Set 迭代序 = 勾选序，与提交顺序一致。空选时按钮不展示，回退保 prop 非空。
  const defaultSavePaths: RecallPathName[] = selectionPaths.size > 0 ? [...selectionPaths] : ["vector"];

  const run = () => {
    const trimmed = query.trim();
    if (!trimmed || recallTest.isPending) {
      return;
    }
    setExpandedKey(null);
    setSelectedChunks([]);
    const clampedTopK = Math.min(20, Math.max(1, Math.trunc(topK) || 5));
    recallTest.mutate(
      { query: trimmed, top_k: clampedTopK },
      {
        onError: (error) => {
          toast.error(error instanceof Error && error.message ? error.message : tr.failed);
        },
      },
    );
  };

  const toggle = (key: string) => setExpandedKey((current) => (current === key ? null : key));

  const pathName: Record<RecallPathName, string> = {
    vector: tr.vectorPath,
    graph: tr.graphPath,
    wiki: tr.wikiPath,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="recall-test-panel">
      {/* Controls：成本提示不再独占一行（2026-08-30），收进「开始检索」按钮 tooltip；
          py-2 + 栏内控件全锁 h-7 → 44px，对齐全知识库页工具栏基准（默认 h-9 会撑成 52px） */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Input
          className="h-7 text-xs"
          placeholder={tr.queryPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              run();
            }
          }}
        />
        <Input
          aria-label={tr.topK}
          className="h-7 w-20 shrink-0 text-xs"
          max={20}
          min={1}
          type="number"
          value={topK}
          onChange={(event) => setTopK(Number(event.target.value))}
        />
        <Tooltip content={tr.costHint}>
          <Button className="h-7 shrink-0" disabled={!query.trim() || recallTest.isPending} onClick={run}>
            {recallTest.isPending ? tr.running : tr.run}
          </Button>
        </Tooltip>
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!result && (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
            <FlaskConical className="size-5" />
            <p>{tr.empty}</p>
          </div>
        )}
        {result && (
          <div className="flex flex-col gap-5">
            {/* P6 检索联动（spec §9 通道一）：一键切向量空间叠加本次检索。
                vector 路无命中时禁用——query 还在，但没有可高亮的命中点。 */}
            {onViewInVectorSpace && (
              <Button
                className="self-start"
                disabled={result.paths.vector.hits.length === 0}
                size="sm"
                variant="outline"
                onClick={() =>
                  onViewInVectorSpace({
                    source: "recall",
                    text: result.query,
                    hits: result.paths.vector.hits.map((hit) => ({ pointId: hit.chunk_id, score: hit.score })),
                  })
                }
              >
                <Waypoints className="size-3.5" />
                {tr.viewInVectorSpace}
              </Button>
            )}
            {/* Vector path */}
            <section className="flex flex-col gap-2" data-testid="recall-path-vector">
              <PathHeader
                elapsedMs={result.elapsed_ms.vector}
                message={result.paths.vector.message}
                name={pathName.vector}
                scoreType={result.score_type.vector}
              />
              {result.paths.vector.hits.map((hit: RecallVectorHit) => (
                <ChunkHitRow
                  expanded={expandedKey === `vector:${hit.chunk_id}`}
                  hit={hit}
                  kbId={kbId}
                  key={hit.chunk_id}
                  score={hit.score}
                  checked={selectedChunks.some((item) => item.id === hit.chunk_id)}
                  testId={`recall-vector-hit-${hit.chunk_id}`}
                  onCheckChange={() => toggleChunk(hit.chunk_id, "vector")}
                  selectLabel={`${tr.saveAsQuestion.button}: ${hit.doc_name}`}
                  selectTestId={`recall-select-vector-${hit.chunk_id}`}
                  onToggle={() => toggle(`vector:${hit.chunk_id}`)}
                />
              ))}
            </section>

            {/* Graph path */}
            <section className="flex flex-col gap-2" data-testid="recall-path-graph">
              <PathHeader
                elapsedMs={result.elapsed_ms.graph}
                message={result.paths.graph.message}
                name={pathName.graph}
                scoreType={result.score_type.graph}
              />
              {result.paths.graph.entities.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">{tr.entities}:</span>
                  {result.paths.graph.entities.map((entity) => (
                    <Badge key={entity.name} title={entity.description} variant="secondary">
                      {entity.name}
                    </Badge>
                  ))}
                </div>
              )}
              {result.paths.graph.relations.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {result.paths.graph.relations.map((relation, index) => (
                    <span className="text-muted-foreground text-xs" key={`${relation.source}-${relation.target}-${index}`}>
                      {relation.source} —{relation.relation}→ {relation.target}
                    </span>
                  ))}
                </div>
              )}
              {result.paths.graph.evidence.map((hit: RecallGraphEvidence) => (
                <ChunkHitRow
                  expanded={expandedKey === `graph:${hit.chunk_id}`}
                  hit={hit}
                  kbId={kbId}
                  key={hit.chunk_id}
                  score={hit.score}
                  checked={selectedChunks.some((item) => item.id === hit.chunk_id)}
                  testId={`recall-graph-hit-${hit.chunk_id}`}
                  onCheckChange={() => toggleChunk(hit.chunk_id, "graph")}
                  selectLabel={`${tr.saveAsQuestion.button}: ${hit.doc_name}`}
                  selectTestId={`recall-select-graph-${hit.chunk_id}`}
                  onToggle={() => toggle(`graph:${hit.chunk_id}`)}
                />
              ))}
            </section>

            {/* Wiki path */}
            <section className="flex flex-col gap-2" data-testid="recall-path-wiki">
              <PathHeader
                elapsedMs={result.elapsed_ms.wiki}
                message={result.paths.wiki.message}
                name={pathName.wiki}
                scoreType={result.score_type.wiki}
              />
              {result.paths.wiki.hits.map((hit: RecallWikiHit) => {
                // 可锚定 = 词条且携带源切片（后端 Task 5 注入）；人工卡片无源切片，
                // 不可锚定（2026-08-28 §5：无勾选框 + tooltip 解释）。
                const anchorable = hit.source_type !== "manual" && (hit.source_chunk_ids?.length ?? 0) > 0;
                const row = (
                  <button
                    className={cn(
                      "hover:bg-muted/50 flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left",
                      anchorable && "min-w-0 flex-1",
                    )}
                    data-testid={`recall-wiki-hit-${hit.entry_id}`}
                    key={hit.entry_id}
                    title={hit.source_type === "manual" ? tr.wikiAnchorTooltip : undefined}
                    type="button"
                    onClick={() =>
                      hit.source_type === "manual" ? onOpenManualCard?.(hit.entry_id) : onOpenWikiEntry(hit.entry_id)
                    }
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground text-xs">#{hit.rank}</span>
                      {hit.source_type === "manual" && (
                        <Badge className="shrink-0 text-[10px]" variant="secondary">
                          {t.knowledge.chat.sourceTypeManual}
                        </Badge>
                      )}
                      <span className="min-w-0 truncate font-medium">{hit.title}</span>
                      <span className="text-muted-foreground ml-auto shrink-0 font-mono text-xs">{formatScore(hit.score)}</span>
                    </span>
                    <span className="text-muted-foreground line-clamp-2 text-xs">{hit.summary}</span>
                  </button>
                );
                if (!anchorable) return row;
                return (
                  <div className="flex items-start gap-1.5" key={hit.entry_id}>
                    <Checkbox
                      aria-label={`${tr.saveAsQuestion.button}: ${hit.title}`}
                      checked={wikiEntryChecked(hit)}
                      className="mt-2 shrink-0"
                      data-testid={`recall-select-wiki-${hit.entry_id}`}
                      onCheckedChange={() => toggleWikiEntry(hit)}
                    />
                    {row}
                  </div>
                );
              })}
            </section>

            {/* 存为考题栏（§7.1）：勾选 ≥1 浮出——造题主入口，题库随使用自然生长 */}
            {selectedChunks.length > 0 && (
              <div className="bg-background sticky bottom-0 flex items-center gap-2 border-t py-2">
                <span className="text-muted-foreground text-xs">
                  {tr.saveAsQuestion.selectedCount(selectedChunks.length)}
                </span>
                <Button className="ml-auto shrink-0" size="sm" onClick={() => setSaveOpen(true)}>
                  <FlaskConical className="size-3.5" />
                  {tr.saveAsQuestion.button}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 存为考题 dialog：query 预填当前输入，保存成功清勾选继续标注（不跳视图） */}
      <EvalSaveQuestionDialog
        defaultPaths={defaultSavePaths}
        kbId={kbId}
        onOpenChange={setSaveOpen}
        onSaved={() => setSelectedChunks([])}
        open={saveOpen}
        prefillQuery={query}
        selectedChunkIds={selectedChunks.map((item) => item.id)}
      />
    </div>
  );
}
