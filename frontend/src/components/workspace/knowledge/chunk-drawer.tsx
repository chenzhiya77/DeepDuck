"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, ImageOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { listDocumentChunks, shotFrameUrl } from "@/core/knowledge/api";
import { chunkPreview, formatTimecodeRange } from "@/core/knowledge/format";
import {
  knowledgeChunksKey,
  useDeleteChunk,
  usePreviewChunkDeletion,
  useReExtractChunk,
  useUpdateChunk,
} from "@/core/knowledge/hooks";
import type {
  DeletePreviewResponse,
  KnowledgeChunk,
  KnowledgeDocument,
} from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { ChunkCard } from "./chunk-card";
import { ChunkTickRail, type ChunkTickEntry } from "./chunk-tick-rail";
import { DeletePreviewDialog } from "./delete-preview-dialog";
import { FileTypeBadge } from "./file-type-badge";
import { toast } from "./kb-toast";

const PAGE_SIZE = 20;
/** 单文档切片在该阈值内一次性全量加载（2026-09-05 切片导航）：刻度弹窗每行都有
    真实预览、跳转纯前端；超过才退回「加载更多」+ 弹窗灰显未加载行。 */
const FULL_LOAD_CAP = 300;

/**
 * 视频镜头条（spec 2026-09-08 §5，plan Task 10）：切片抽屉里视频 chunk 卡片上方
 * 的时间码芯片 + 关键帧缩略图 + 复制按钮。数据来自后端 chunks 端点 join
 * ``video_shots`` 注入的 ``media``/``shot_index``/``start_ms``/``end_ms``/``frame_url``。
 * 缩略图 lazy 加载，缺帧（无 ``frame_url``）或 404（``onError``）都降级为缺图图标。
 * 芯片正文按原文展示（``chunks.text`` 不含时间码头，spec §3 嵌入文本契约）；
 * 芯片/缩略图的点击 seek 播放语义留待 Task 10b，本组件只做展示 + 复制时间码。
 */
function VideoShotBar({
  chunk,
  kbId,
  docId,
}: {
  chunk: KnowledgeChunk;
  kbId: string;
  docId: string;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chunkDrawer;
  const [frameFailed, setFrameFailed] = useState(false);
  const shotIndex = chunk.shot_index ?? 0;
  const timecode = formatTimecodeRange(chunk.start_ms ?? 0, chunk.end_ms ?? 0);
  const hasFrame = Boolean(chunk.frame_url) && !frameFailed;
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(timecode);
      toast.success(tc.copiedTimecode);
    } catch {
      toast.error(tc.copyTimecodeFailed);
    }
  };
  return (
    <div className="flex items-center gap-2 pb-1.5" data-testid="video-shot-bar">
      {hasFrame ? (
        <img
          alt=""
          className="h-9 w-16 shrink-0 rounded border object-cover"
          data-testid="shot-thumbnail"
          decoding="async"
          loading="lazy"
          onError={() => setFrameFailed(true)}
          src={shotFrameUrl(kbId, docId, shotIndex)}
        />
      ) : (
        <span
          className="text-muted-foreground flex h-9 w-16 shrink-0 items-center justify-center rounded border border-dashed"
          data-testid="shot-thumbnail-missing"
          title={tc.frameMissing}
        >
          <ImageOff className="size-4" />
        </span>
      )}
      {/* mono 等宽时间码芯片（spec §5）：#K 为镜头序号（1 基，与卡片 #N 同序）。 */}
      <span
        className="text-muted-foreground font-mono text-xs tabular-nums"
        data-testid="timecode-chip"
        title={tc.timecodeChip}
      >
        #{shotIndex + 1} · {timecode}
      </span>
      <Button
        aria-label={tc.copyTimecode}
        className="size-7 shrink-0"
        data-testid="copy-timecode"
        onClick={() => void handleCopy()}
        size="icon"
        title={tc.copyTimecode}
        variant="ghost"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Chunk preview drawer (spec §3.6): opens from a document row click and
 * paginates through the chunks endpoint. Phase-3 Batch-1 adds edit/delete actions.
 */
export function ChunkDrawer({
  kbId,
  doc,
  open,
  onOpenChange,
  focusChunkId = null,
}: {
  kbId: string;
  doc: KnowledgeDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 检索测试跳转入口（2026-09-05 两层重设计）：打开后定位到该切片并闪环。 */
  focusChunkId?: string | null;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chunkDrawer;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingJumpRef = useRef<number | null>(null);
  const [reExtractingChunkId, setReExtractingChunkId] = useState<string | null>(
    null,
  );

  // Use raw query for configurable polling when pending extraction detected
  const query = useQuery({
    queryKey: knowledgeChunksKey(kbId, doc.id, 0, limit),
    queryFn: () => listDocumentChunks(kbId, doc.id, { offset: 0, limit }),
    enabled: open,
    // 条件轮询（2026-09-05 切片导航）：全量加载后无条件 3s refetch 会反复拉整份
    // 切片 payload；仅当确有抽取在飞时才轮询。
    refetchInterval: (q) =>
      reExtractingChunkId !== null ||
      (q.state.data?.items ?? []).some((chunk) => chunk.extract_status === "pending")
        ? 3000
        : false,
  });
  const page = query.data;
  const isLoading = query.isLoading;
  // useMemo 稳定引用：items 是多个 effect/memo 的依赖，裸 ?? [] 每渲染新数组
  // 会让它们每帧重跑（react-hooks/exhaustive-deps）。
  const items = useMemo(() => page?.items ?? [], [page]);

  const total = page?.total ?? 0;
  const hasMore = items.length < total;

  // 阈值内一次性全量加载（2026-09-05 切片导航）：刻度弹窗每行都有真实预览、
  // 跳转纯前端；超过 FULL_LOAD_CAP 才退回「加载更多」+ 弹窗灰显未加载行。
  useEffect(() => {
    if (total > 0 && total <= FULL_LOAD_CAP) {
      setLimit((value) => (value < total ? total : value));
    }
  }, [total]);

  // ── 切片导航（2026-09-05）：sticky 头部位置感 + 刻度轨/↑↓ 跳转 ──────────
  const itemsRef = useRef<KnowledgeChunk[]>([]);
  itemsRef.current = items;

  const scrollToIndex = useCallback((index: number) => {
    const viewport = viewportRef.current;
    const card = cardRefs.current.get(index);
    if (!viewport || !card) return;
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const top =
      card.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop -
      headerHeight -
      8;
    viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setFlashIndex(index);
    window.setTimeout(
      () => setFlashIndex((value) => (value === index ? null : value)),
      1200,
    );
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= total) return;
      if (index >= itemsRef.current.length) {
        // 目标尚未加载：先扩 limit，数据到位后由下方 effect 续跳。
        pendingJumpRef.current = index;
        setLimit((value) =>
          Math.max(value, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE),
        );
        return;
      }
      scrollToIndex(index);
    },
    [total, scrollToIndex],
  );

  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending === null || pending >= items.length) return;
    pendingJumpRef.current = null;
    requestAnimationFrame(() => scrollToIndex(pending));
  }, [items, scrollToIndex]);

  // 检索测试跳转（2026-09-05）：按 chunk_id 找位置复用 scrollToIndex 闪环；
  // 目标未加载时逐页扩 limit 直到命中。active 徽章同步置位（smooth 滚动
  // 落定前头部即显示正确位置）；关抽屉重置，同 id 再开仍会重跳。
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      focusedIdRef.current = null;
      return;
    }
    if (!focusChunkId || focusedIdRef.current === focusChunkId) return;
    const position = items.findIndex(
      (chunk) => chunk.chunk_id === focusChunkId,
    );
    if (position >= 0) {
      focusedIdRef.current = focusChunkId;
      setActiveIndex(position);
      requestAnimationFrame(() => scrollToIndex(position));
    } else if (items.length < total) {
      setLimit((value) => value + PAGE_SIZE);
    }
  }, [open, focusChunkId, items, total, scrollToIndex]);

  // active = 顶部越过视口上 1/3 带的最后一张卡；rAF 节流的 scroll 监听挂在
  // Radix viewport 元素上（ScrollArea 经 viewportRef 外露）。
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const band =
        viewport.getBoundingClientRect().top + viewport.clientHeight * 0.35;
      let current = 0;
      for (const [position] of itemsRef.current.entries()) {
        const card = cardRefs.current.get(position);
        if (!card || card.getBoundingClientRect().top > band) break;
        current = position;
      }
      setActiveIndex(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [open, items]);

  const railEntries = useMemo<ChunkTickEntry[]>(
    () =>
      items.map((chunk) => ({
        index: chunk.chunk_index,
        preview: chunkPreview(chunk),
      })),
    [items],
  );

  const updateChunk = useUpdateChunk(kbId);
  const previewDeletion = usePreviewChunkDeletion(kbId);
  const reExtractChunk = useReExtractChunk(kbId);
  const deleteChunk = useDeleteChunk(kbId);

  const [deletePreviewOpen, setDeletePreviewOpen] = useState(false);
  const [deletePreview, setDeletePreview] =
    useState<DeletePreviewResponse | null>(null);
  // Task 5 收尾: the preview response carries no chunk id, so the confirm
  // handler needs the target remembered at preview time.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleEditChunk = async (chunkId: string, newText: string) => {
    try {
      await updateChunk.mutateAsync({ chunkId, body: { text: newText } });
      toast.success("切片已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
      throw error;
    }
  };

  const handleDeleteChunk = async (chunkId: string) => {
    try {
      const preview = await previewDeletion.mutateAsync({
        chunk_ids: [chunkId],
      });
      setDeletePreview(preview);
      setDeleteTargetId(chunkId);
      setDeletePreviewOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预览失败");
    }
  };

  const handleReExtractChunk = async (chunkId: string) => {
    setReExtractingChunkId(chunkId);
    try {
      await reExtractChunk.mutateAsync(chunkId);
      toast.success("重抽取完成，实体已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "重抽取失败";
      if (message.includes("being processed")) {
        toast.warning("文档正在处理中，请稍后重试");
      } else {
        toast.error(message);
      }
    } finally {
      setReExtractingChunkId(null);
    }
  };

  // Task 5 收尾: run the real cascade delete (graph/wiki/vector/row all
  // server-side); 409 mirrors the re-extract guard (pipeline mid-flight).
  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteChunk.mutateAsync(deleteTargetId);
      toast.success(tc.deleteSuccess);
    } catch (error) {
      const message = error instanceof Error ? error.message : tc.deleteFailed;
      if (message.includes("being processed")) {
        toast.warning(tc.deleteProcessing);
      } else {
        toast.error(message);
      }
      return; // keep the dialog open so the user can retry
    } finally {
      setDeleteTargetId(null);
    }
    setDeletePreviewOpen(false);
    setDeletePreview(null);
  };

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          className="w-full overflow-hidden sm:max-w-xl"
          side="right"
        >
          {/* 百科 Tab 容器同款 overlay 滚动条（2026-09-04，EvalRunDrawer 同款）：整抽屉经
              ScrollArea 滚动；头部 sticky 留在视口内承担位置感（2026-09-05 切片导航）。 */}
          <div className="relative min-h-0 flex-1">
            <ScrollArea
              className="size-full"
              scrollHideDelay={2000}
              type="scroll"
              viewportRef={viewportRef}
            >
              <SheetHeader
                className="sticky top-0 z-10 border-b bg-background/95 px-4 py-2.5 backdrop-blur-sm"
                ref={headerRef}
              >
                {/* 单行紧凑头（2026-09-05 头部重设计）：文档名主标题 + 类型徽章，
                    计数/当前位置徽章芯片化（不再裸文字）；描述仅 sr-only 供无障碍。 */}
                <div className="flex items-center justify-between gap-2 pr-8">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* 文档类型图标（2026-09-05）：复用文档列表同款 FileTypeBadge
                        （size-5 = 保住折角细节的 S 档），标题与列表视觉同源。 */}
                    <FileTypeBadge className="size-5 shrink-0" fileName={doc.name} />
                    <SheetTitle className="truncate">{doc.name}</SheetTitle>
                    <Badge className="shrink-0 text-[10px]" variant="secondary">
                      {tc.title}
                    </Badge>
                    <Badge className="shrink-0 text-[10px] tabular-nums" variant="outline">
                      {total} {tc.chunkUnit}
                    </Badge>
                    {total > 0 && (
                      <Badge className="shrink-0 text-[10px] tabular-nums" variant="outline">
                        {tc.current} #{activeIndex + 1}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      aria-label={tc.prevChunk}
                      className="size-7"
                      disabled={activeIndex <= 0}
                      onClick={() => jumpTo(activeIndex - 1)}
                      size="icon"
                      title={tc.prevChunk}
                      variant="ghost"
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      aria-label={tc.nextChunk}
                      className="size-7"
                      disabled={activeIndex >= total - 1}
                      onClick={() => jumpTo(activeIndex + 1)}
                      size="icon"
                      title={tc.nextChunk}
                      variant="ghost"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </div>
                </div>
                <SheetDescription className="sr-only">
                  {total} {tc.chunkUnit}
                  {total > 0 ? ` · ${tc.current} #${activeIndex + 1}` : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-2 px-4 pt-4 pb-6">
              {(page?.items ?? []).length === 0 && !isLoading ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {tc.empty}
                </p>
              ) : (
                (page?.items ?? []).map((chunk, position) => (
                  <div
                    className={cn(
                      "rounded-md transition-shadow duration-500",
                      flashIndex === position && "ring-ring/60 ring-2",
                    )}
                    key={chunk.chunk_id}
                    ref={(el) => {
                      // refs 以列表位置为键（2026-09-05 序号统一）：chunk_index 是
                      // 稳定身份（删除留空洞），UI 序号/跳转/active 全走位置序。
                      if (el) cardRefs.current.set(position, el);
                      else cardRefs.current.delete(position);
                    }}
                  >
                    {chunk.media === "video" && (
                      <VideoShotBar chunk={chunk} docId={doc.id} kbId={kbId} />
                    )}
                    <ChunkCard
                      chunkId={chunk.chunk_id}
                      docId={doc.id}
                      entities={chunk.entities}
                      headingPath={chunk.heading_path}
                      index={position}
                      kbId={kbId}
                      isReExtracting={reExtractingChunkId === chunk.chunk_id}
                      lastEditedAt={chunk.last_edited_at}
                      onDelete={handleDeleteChunk}
                      onEdit={handleEditChunk}
                      onReExtract={handleReExtractChunk}
                      page={chunk.page}
                      reExtractDisabled={
                        reExtractingChunkId !== null &&
                        reExtractingChunkId !== chunk.chunk_id
                      }
                      text={chunk.text}
                      tokenCount={chunk.token_count}
                      extractStatus={chunk.extract_status}
                    />
                  </div>
                ))
              )}
              {isLoading && (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  {tc.loading}
                </p>
              )}
              {hasMore && !isLoading && (
                <Button
                  className="self-center"
                  onClick={() => setLimit((value) => value + PAGE_SIZE)}
                  size="sm"
                  variant="ghost"
                >
                  {tc.loadMore}
                </Button>
              )}
              </div>
            </ScrollArea>
            <ChunkTickRail
              active={activeIndex}
              entries={railEntries}
              onJump={jumpTo}
              tickLabel={tc.tickAria}
              total={total}
              unloadedLabel={tc.notLoaded}
            />
          </div>
        </SheetContent>
      </Sheet>

      <DeletePreviewDialog
        isDeleting={deleteChunk.isPending}
        onConfirm={handleConfirmDelete}
        onOpenChange={setDeletePreviewOpen}
        open={deletePreviewOpen}
        preview={deletePreview}
      />
    </>
  );
}
