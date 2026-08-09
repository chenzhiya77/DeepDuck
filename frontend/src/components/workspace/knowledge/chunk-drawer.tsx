"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useDocumentChunks } from "@/core/knowledge/hooks";
import type { KnowledgeChunk, KnowledgeDocument } from "@/core/knowledge/types";

import { ChunkCard } from "./chunk-card";

const PAGE_SIZE = 20;

/**
 * Read-only chunk preview drawer (spec §3.6 一期只读): opens from a document
 * row click and paginates through the chunks endpoint.
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
  const query = useDocumentChunks(open ? kbId : null, open ? doc.id : null, 0, limit);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle>
            {tc.title} · {doc.name}
          </SheetTitle>
          <SheetDescription>
            {total} chunks
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          {accumulated.length === 0 && !query.isLoading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">{tc.empty}</p>
          ) : (
            accumulated.map((chunk) => (
              <ChunkCard
                key={chunk.chunk_id}
                entities={chunk.entities}
                headingPath={chunk.heading_path}
                page={chunk.page}
                text={chunk.text}
                tokenCount={chunk.token_count}
              />
            ))
          )}
          {query.isLoading && <p className="text-muted-foreground py-4 text-center text-xs">{tc.loading}</p>}
          {hasMore && !query.isLoading && (
            <Button className="self-center" size="sm" variant="ghost" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              {tc.loadMore}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
