"use client";

/**
 * 知识图谱面板（2026-08-19 spec §5 P2）：数据/状态/钻取分发。持有
 * useKnowledgeGraph 查询与实体详情抽屉；画布经 next/dynamic 懒加载隔离
 * （jsdom 中整体 mock）。
 *
 * 钻取链路：点击节点 → 右侧抽屉（实体详情 + 关联切片列表）→ 点击切片
 * → onOpenChunk(docId, chunkId) 复用文档抽屉链路（chunk_id 内嵌 doc_id，
 * 前端无需二次查询）。
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useKnowledgeGraph } from "@/core/knowledge/hooks";
import type { KnowledgeDocument, KnowledgeGraphNode } from "@/core/knowledge/types";

import type { GraphCanvasProps } from "./graph-canvas";

// ssr:false —— echarts 依赖 DOM，且不进首屏 chunk（对齐 vector-tab 先例）。
const GraphCanvas = dynamic<GraphCanvasProps>(() => import("./graph-canvas"), { ssr: false });

/** chunk_id（`{doc_id}#%04d`）→ doc_id；格式异常时返回 null（防御）。 */
function docIdOfChunk(chunkId: string): string | null {
  const sep = chunkId.lastIndexOf("#");
  return sep > 0 ? chunkId.slice(0, sep) : null;
}

export function GraphTab({
  kbId,
  enabled,
  documents,
  onOpenChunk,
}: {
  kbId: string;
  /** keep-alive pane 的懒加载门：仅 tab 激活后才发起图数据请求。 */
  enabled: boolean;
  /** 文档列表（切片条目显示所属文档名；page 层已有，直接透传）。 */
  documents: readonly KnowledgeDocument[];
  /** 切片点击：(doc_id, chunk_id) —— page 层打开文档抽屉。 */
  onOpenChunk: (docId: string, chunkId: string) => void;
}) {
  const { t } = useI18n();
  const tg = t.knowledge.graphSpace;
  const graphQuery = useKnowledgeGraph(kbId, enabled);
  const graph = graphQuery.data;

  /** 当前打开的实体抽屉（null = 关闭）。 */
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);

  /** doc_id → 文档名（切片条目的可辨识跳转目标）。 */
  const docNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) map.set(doc.id, doc.name);
    return map;
  }, [documents]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="graph-tab">
      {/* 状态栏：图规模统计（spec §4 stats 的观察位） */}
      {graph && (
        <div className="text-muted-foreground shrink-0 border-b px-4 py-2 text-xs" data-testid="graph-stats">
          {tg.stats(graph.stats.node_count, graph.stats.edge_count, graph.stats.community_count)}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {graphQuery.isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm" data-testid="graph-loading">
            {tg.loading}
          </div>
        ) : graphQuery.isError ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm" data-testid="graph-error">
            {tg.loadFailed}
          </div>
        ) : !graph || graph.nodes.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm" data-testid="graph-empty">
            {tg.empty}
          </div>
        ) : (
          <GraphCanvas nodes={graph.nodes} edges={graph.edges} onNodeClick={setSelected} />
        )}
      </div>

      {/* 实体详情抽屉：详情 + 关联切片列表 → 跳文档抽屉 */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto" data-testid="graph-entity-sheet" side="right">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.id}</SheetTitle>
                <SheetDescription>
                  {selected.type && <span className="mr-2">{selected.type}</span>}
                  {tg.mentions(selected.mention_count)}
                </SheetDescription>
              </SheetHeader>
              {selected.description && (
                <p className="text-muted-foreground px-4 text-sm whitespace-pre-wrap">{selected.description}</p>
              )}
              <div className="px-4">
                <div className="text-muted-foreground mb-2 text-xs font-medium">{tg.relatedChunks}</div>
                <ul className="space-y-1">
                  {selected.source_chunk_ids.map((chunkId) => {
                    const docId = docIdOfChunk(chunkId);
                    const docName = docId ? (docNameById.get(docId) ?? tg.unknownDoc) : tg.unknownDoc;
                    return (
                      <li key={chunkId}>
                        <button
                          className="hover:bg-accent w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                          data-testid="graph-entity-chunk"
                          type="button"
                          onClick={() => docId && onOpenChunk(docId, chunkId)}
                        >
                          <span className="font-medium">{docName}</span>
                          <span className="text-muted-foreground ml-1.5">{chunkId}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
