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
import { ChevronLeft, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import { useKnowledgeGraph } from "@/core/knowledge/hooks";
import type { GraphRetrievalOverlay, KnowledgeDocument, KnowledgeGraphNode } from "@/core/knowledge/types";

import type { GraphCanvasProps } from "./graph-canvas";
import { filterNeighborhood, type GraphColorBy, matchEntityNames, type RenderTier } from "./graph-utils";

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
  overlay,
  followChat: followChatProp,
  onFollowChatChange,
}: {
  kbId: string;
  /** keep-alive pane 的懒加载门：仅 tab 激活后才发起图数据请求。 */
  enabled: boolean;
  /** 文档列表（切片条目显示所属文档名；page 层已有，直接透传）。 */
  documents: readonly KnowledgeDocument[];
  /** 切片点击：(doc_id, chunk_id) —— page 层打开文档抽屉。 */
  onOpenChunk: (docId: string, chunkId: string) => void;
  /**
   * P4 检索联动（2026-08-19 spec §7）：page 层共享的 graph_search 轨迹叠加
   * 请求。chat 通道受「跟随对话」开关管辖（冻结语义在本组件内）。
   */
  overlay?: GraphRetrievalOverlay | null;
  /** 「跟随对话」开关（与向量空间共享状态，spec §7）；缺省 = 内部状态。 */
  followChat?: boolean;
  onFollowChatChange?: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const tg = t.knowledge.graphSpace;
  const graphQuery = useKnowledgeGraph(kbId, enabled);
  const graph = graphQuery.data;

  /** 当前打开的实体抽屉（null = 关闭）。 */
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);
  /** 着色模式（spec §6：默认按社区，结构洞察优先）。 */
  const [colorBy, setColorBy] = useState<GraphColorBy>("community");
  /** 搜索框输入与定位目标（命中节点居中高亮）。 */
  const [query, setQuery] = useState("");
  const [focusNode, setFocusNode] = useState<string | null>(null);
  /** 局部图模式（spec §6：双击节点进入，面包屑返回全局）。 */
  const [neighborhood, setNeighborhood] = useState<{ focusId: string; hops: 1 | 2 } | null>(null);
  /** 当前 LOD 渲染档位（canvas 上报；guide 档显示引导提示）。 */
  const [renderTier, setRenderTier] = useState<RenderTier>("full");

  // ── P4 检索路径叠加（spec §7）──────────────────────────────────────────
  // 受控/非受控混合：page 层共享「跟随对话」状态时经 props 下发，独立使用时
  // 回落内部状态（与 vector-tab 同模式）。
  const [internalFollowChat, setInternalFollowChat] = useState(true);
  const followChat = followChatProp ?? internalFollowChat;
  const setFollowChat = onFollowChatChange ?? setInternalFollowChat;

  /** 已应用的叠加 + 应用时的图指纹（node_count:edge_count，stats 现成廉价）。 */
  const [activeOverlay, setActiveOverlay] = useState<{ overlay: GraphRetrievalOverlay; fingerprint: string } | null>(null);
  /** 请求去重句柄：同一 overlay 对象只应用一次（流式重渲染不重复叠加）。 */
  const consumedOverlayRef = useRef<GraphRetrievalOverlay | null>(null);
  const fingerprint = graph ? `${graph.stats.node_count}:${graph.stats.edge_count}` : null;
  const activeOverlayRef = useRef(activeOverlay);
  activeOverlayRef.current = activeOverlay;

  // 叠加消费：图数据就绪（指纹可用）才应用——keep-alive pane 的查询是懒门控，
  // 用户未到访过图谱 tab 时等图落地后再应用（effect 随 fingerprint 重跑）。
  // chat 通道受「跟随对话」管辖：冻结时不写 consumed——解冻后重跑即应用最新一轮。
  useEffect(() => {
    if (!overlay || !fingerprint) return;
    if (consumedOverlayRef.current === overlay) return;
    if (overlay.source === "chat" && !followChat) return;
    consumedOverlayRef.current = overlay;
    setActiveOverlay({ overlay, fingerprint });
  }, [overlay, fingerprint, followChat]);

  // 指纹漂移（文档增删改 → 图数据变化）→ 旧叠加留在图上就是误导，清除并提示。
  useEffect(() => {
    const current = activeOverlayRef.current;
    if (current && fingerprint && current.fingerprint !== fingerprint) {
      setActiveOverlay(null);
      toast.info(tg.overlayStale);
    }
  }, [fingerprint, tg]);

  /** 可见子图：实体局部图（N 跳邻居）/ 全量。 */
  const visible = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    if (!neighborhood) return { nodes: graph.nodes, edges: graph.edges };
    return filterNeighborhood(graph.nodes, graph.edges, neighborhood.focusId, neighborhood.hops);
  }, [graph, neighborhood]);

  /** 局部图模式下社区汇总同步裁剪（hub 层枢纽选择只覆盖可见社区；全局模式全量）。 */
  const visibleCommunities = useMemo(() => {
    if (!graph) return [];
    if (!neighborhood) return graph.communities;
    const visibleCommunityIds = new Set(visible.nodes.map((node) => node.community));
    return graph.communities.filter((community) => visibleCommunityIds.has(community.id));
  }, [graph, visible, neighborhood]);

  /** 搜索提交：模糊匹配第一个命中 → 画布居中高亮；无命中提示。 */
  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const [first] = matchEntityNames(visible.nodes, query);
    if (first) {
      setFocusNode(first);
    } else if (query.trim()) {
      toast.info(tg.searchNoMatch);
    }
  };

  /** doc_id → 文档名（切片条目的可辨识跳转目标）。 */
  const docNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) map.set(doc.id, doc.name);
    return map;
  }, [documents]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="graph-tab">
      {/* 工具栏：实体搜索 + 着色切换 + 图规模统计 */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <form className="relative w-40" onSubmit={handleSearch}>
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            aria-label={tg.searchEntities}
            className="h-7 pr-6 pl-7 text-xs"
            placeholder={tg.searchEntities}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <ToggleGroup
          aria-label={tg.colorByCommunity}
          size="sm"
          type="single"
          value={colorBy}
          onValueChange={(value) => value && setColorBy(value as GraphColorBy)}
        >
          <ToggleGroupItem aria-label={tg.colorByCommunity} className="h-7 px-2 text-xs" value="community">
            {tg.colorByCommunity}
          </ToggleGroupItem>
          <ToggleGroupItem aria-label={tg.colorByType} className="h-7 px-2 text-xs" value="type">
            {tg.colorByType}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          {/* P4「跟随对话」开关（spec §7）：默认开；关闭后 chat 通道叠加冻结。
              状态与向量空间共享（page 层下发时受控）。 */}
          <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
            <Switch
              aria-label={tg.followChat}
              checked={followChat}
              className="shrink-0"
              onCheckedChange={setFollowChat}
            />
            <span className="whitespace-nowrap">{tg.followChat}</span>
          </label>
        </div>
      </div>

      {/* 局部图面包屑（实体邻居；返回按钮清模式） */}
      {neighborhood && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5" data-testid="graph-breadcrumb">
          <Button
            className="h-6 gap-1 px-1.5 text-xs"
            data-testid="graph-breadcrumb-back"
            size="sm"
            variant="ghost"
            onClick={() => {
              setNeighborhood(null);
            }}
          >
            <ChevronLeft className="size-3.5" />
            {tg.backToGlobal}
          </Button>
          <span className="text-xs font-medium">{tg.neighborhoodOf(neighborhood.focusId)}</span>
          <ToggleGroup
            aria-label={tg.hop1}
            className="ml-auto"
            size="sm"
            type="single"
            value={String(neighborhood.hops)}
            onValueChange={(value) =>
              (value === "1" || value === "2") && setNeighborhood({ ...neighborhood, hops: Number(value) as 1 | 2 })
            }
          >
            <ToggleGroupItem aria-label={tg.hop1} className="h-6 px-2 text-xs" value="1">
              {tg.hop1}
            </ToggleGroupItem>
            <ToggleGroupItem aria-label={tg.hop2} className="h-6 px-2 text-xs" value="2">
              {tg.hop2}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {/* relative 供叠加徽标浮层定位（对齐向量空间徽标模式） */}
      <div className="relative min-h-0 flex-1">
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
          <GraphCanvas
            colorBy={colorBy}
            communities={visibleCommunities}
            edges={visible.edges}
            focusNode={focusNode}
            nodes={visible.nodes}
            overlay={activeOverlay?.overlay.trace ?? null}
            onNodeClick={setSelected}
            onNodeDblClick={(node) => {
              setNeighborhood({ focusId: node.id, hops: 1 });
            }}
            onRenderTierChange={setRenderTier}
          />
        )}
        {/* LOD guide 层引导（实体超 2000 熔断）：右上角低调提示。 */}
        {renderTier === "guide" && !neighborhood && (
          <div
            className="bg-background/80 text-muted-foreground absolute top-2 right-2 z-10 max-w-[45%] rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur"
            data-testid="graph-guide-hint"
          >
            {tg.guideHint}
          </div>
        )}
        {/* 叠加徽标：地图式左上浮层——query 文本 + 种子/扩展/证据三层计数 + × 清除。 */}
        {activeOverlay && (
          <div
            className="bg-background/80 absolute top-2 left-2 z-10 flex max-w-[70%] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur"
            data-testid="graph-overlay-badge"
          >
            {/* 色点与命中节点同色（红）——徽标是叠加层的图例入口。 */}
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: "#f5222d" }} />
            <span className="min-w-0 truncate" title={activeOverlay.overlay.text}>
              {activeOverlay.overlay.text}
            </span>
            <span className="text-muted-foreground shrink-0">
              {tg.overlayLayers(
                activeOverlay.overlay.trace.seed_entities.length,
                activeOverlay.overlay.trace.expanded_nodes.length,
                activeOverlay.overlay.trace.evidence_entities.length,
              )}
            </span>
            <button
              aria-label={tg.clearOverlay}
              className="text-muted-foreground hover:text-foreground ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full"
              type="button"
              onClick={() => setActiveOverlay(null)}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {/* 图规模统计：底部居中低调浮层（不占工具栏行宽，与画布视觉中轴对齐）。 */}
        {graph && (
          <span
            className="bg-background/80 text-muted-foreground absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap shadow-sm backdrop-blur"
            data-testid="graph-stats"
          >
            {tg.stats(graph.stats.node_count, graph.stats.edge_count, graph.stats.community_count)}
          </span>
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
