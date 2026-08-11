"use client";

import { ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import { useRecallTest } from "@/core/knowledge/hooks";
import type {
  RecallGraphEvidence,
  RecallPathName,
  RecallTestResponse,
  RecallVectorHit,
  RecallWikiHit,
} from "@/core/knowledge/types";

import { ChunkCard } from "./chunk-card";

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

/** Collapsible chunk hit (vector path / graph evidence) → shared ChunkCard. */
function ChunkHitRow({
  hit,
  score,
  testId,
  expanded,
  onToggle,
}: {
  hit: { chunk_id: string; doc_name: string; text: string; heading_path: string[]; page: number | null; rank?: number };
  score: number | null;
  testId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
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
        <ChunkCard docName={hit.doc_name} headingPath={hit.heading_path} page={hit.page} text={hit.text} />
      )}
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
}: {
  kbId: string;
  onOpenWikiEntry: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const tr = t.knowledge.recallTest;
  const recallTest = useRecallTest(kbId);
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const result: RecallTestResponse | null = recallTest.data ?? null;

  const run = () => {
    const trimmed = query.trim();
    if (!trimmed || recallTest.isPending) {
      return;
    }
    setExpandedKey(null);
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
      {/* Controls */}
      <div className="flex flex-col gap-1.5 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
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
            className="w-20 shrink-0"
            max={20}
            min={1}
            type="number"
            value={topK}
            onChange={(event) => setTopK(Number(event.target.value))}
          />
          <Button className="shrink-0" disabled={!query.trim() || recallTest.isPending} onClick={run}>
            {recallTest.isPending ? tr.running : tr.run}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{tr.costHint}</p>
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
                  key={hit.chunk_id}
                  score={hit.score}
                  testId={`recall-vector-hit-${hit.chunk_id}`}
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
                  key={hit.chunk_id}
                  score={hit.score}
                  testId={`recall-graph-hit-${hit.chunk_id}`}
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
              {result.paths.wiki.hits.map((hit: RecallWikiHit) => (
                <button
                  className="hover:bg-muted/50 flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left"
                  data-testid={`recall-wiki-hit-${hit.entry_id}`}
                  key={hit.entry_id}
                  type="button"
                  onClick={() => onOpenWikiEntry(hit.entry_id)}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">#{hit.rank}</span>
                    <span className="min-w-0 truncate font-medium">{hit.title}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 font-mono text-xs">{formatScore(hit.score)}</span>
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-xs">{hit.summary}</span>
                </button>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
