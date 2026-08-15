"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useDocumentChunks, usePreviewChunkDeletion, useUpdateChunk } from "@/core/knowledge/hooks";
import type { DeletePreviewResponse, KnowledgeChunk, KnowledgeDocument } from "@/core/knowledge/types";

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
  const [accumulated, setAccumulated] = useState<KnowledgeChunk[]>([]);
  const [deletePreviewOpen, setDeletePreviewOpen] = useState(false);
  const [deletePreview, setDeletePreview] = useState<DeletePreviewResponse | null>(null);
  const query = useDocumentChunks(open ? kbId : null, open ? doc.id : null, 0, limit);
  const updateChunk = useUpdateChunk(kbId);
  const previewDeletion = usePreviewChunkDeletion(kbId);
  const page = query.data;

  // Accumulate pages client-side: the endpoint is offset/limit, and a growing
  // limit refetches the prefix — keeping prior items avoids flicker between
  // pages.
  useEffect(() => {
    if (page?.items) {
      setAccumulated(page.items);
    }
  }, [page]);

  useEffect(() => {
    if (!open) {
      setLimit(PAGE_SIZE);
      setAccumulated([]);
    }
  }, [open, doc.id]);

  const total = page?.total ?? 0;
  const hasMore = accumulated.length < total;

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
      const preview = await previewDeletion.mutateAsync({ chunk_ids: [chunkId] });
      setDeletePreview(preview);
      setDeletePreviewOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预览失败");
    }
  };

  const handleConfirmDelete = async () => {
    // TODO: Implement actual deletion endpoint
    toast.info("删除功能将在下一迭代实现");
    setDeletePreviewOpen(false);
    setDeletePreview(null);
  };

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
          <SheetHeader>
            <SheetTitle>
              {tc.title} · {doc.name}
            </SheetTitle>
            <SheetDescription>{total} chunks</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-6">
            {accumulated.length === 0 && !query.isLoading ? (
              <p className="text-muted-foreground py-8 text-center text-sm">{tc.empty}</p>
            ) : (
              accumulated.map((chunk) => (
                <ChunkCard
                  chunkId={chunk.chunk_id}
                  entities={chunk.entities}
                  headingPath={chunk.heading_path}
                  key={chunk.chunk_id}
                  lastEditedAt={chunk.last_edited_at}
                  onDelete={handleDeleteChunk}
                  onEdit={handleEditChunk}
                  page={chunk.page}
                  text={chunk.text}
                  tokenCount={chunk.token_count}
                />
              ))
            )}
            {query.isLoading && <p className="text-muted-foreground py-4 text-center text-xs">{tc.loading}</p>}
            {hasMore && !query.isLoading && (
              <Button className="self-center" onClick={() => setLimit((value) => value + PAGE_SIZE)} size="sm" variant="ghost">
                {tc.loadMore}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <DeletePreviewDialog
        isDeleting={false}
        onConfirm={handleConfirmDelete}
        onOpenChange={setDeletePreviewOpen}
        open={deletePreviewOpen}
        preview={deletePreview}
      />
    </>
  );
}
