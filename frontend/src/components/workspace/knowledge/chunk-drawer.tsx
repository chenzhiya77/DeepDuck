"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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
import { listDocumentChunks } from "@/core/knowledge/api";
import {
  knowledgeChunksKey,
  useDeleteChunk,
  usePreviewChunkDeletion,
  useReExtractChunk,
  useUpdateChunk,
} from "@/core/knowledge/hooks";
import type {
  DeletePreviewResponse,
  KnowledgeDocument,
} from "@/core/knowledge/types";

import { ChunkCard } from "./chunk-card";
import { DeletePreviewDialog } from "./delete-preview-dialog";

const PAGE_SIZE = 20;

/**
 * Chunk preview drawer (spec §3.6): opens from a document row click and
 * paginates through the chunks endpoint. Phase-3 Batch-1 adds edit/delete actions.
 */
export function ChunkDrawer({
  kbId,
  doc,
  open,
  onOpenChange,
}: {
  kbId: string;
  doc: KnowledgeDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chunkDrawer;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [reExtractingChunkId, setReExtractingChunkId] = useState<string | null>(
    null,
  );

  // Use raw query for configurable polling when pending extraction detected
  const query = useQuery({
    queryKey: knowledgeChunksKey(kbId, doc.id, 0, limit),
    queryFn: () => listDocumentChunks(kbId, doc.id, { offset: 0, limit }),
    enabled: open,
    refetchInterval: 3000, // Always poll at 3s
  });
  const page = query.data;
  const isLoading = query.isLoading;

  const total = page?.total ?? 0;
  const hasMore = (page?.items?.length ?? 0) < total;

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
              ScrollArea 滚动；mt-4 补原 SheetContent gap-4 的头部间距。 */}
          <ScrollArea
            className="min-h-0 flex-1"
            scrollHideDelay={2000}
            type="scroll"
          >
            <SheetHeader>
              <SheetTitle>
                {tc.title} · {doc.name}
              </SheetTitle>
              <SheetDescription>{total} chunks</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-2 px-4 pb-6">
              {(page?.items ?? []).length === 0 && !isLoading ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {tc.empty}
                </p>
              ) : (
                (page?.items ?? []).map((chunk) => (
                  <ChunkCard
                    chunkId={chunk.chunk_id}
                    docId={doc.id}
                    entities={chunk.entities}
                    headingPath={chunk.heading_path}
                    kbId={kbId}
                    isReExtracting={reExtractingChunkId === chunk.chunk_id}
                    key={chunk.chunk_id}
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
