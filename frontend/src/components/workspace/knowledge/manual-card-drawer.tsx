"use client";

import { StickyNote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { formatKnowledgeTimestamp } from "@/core/knowledge/format";
import { useManualCard } from "@/core/knowledge/hooks";

/**
 * Manual knowledge card full-text drawer (Phase-3 P6 fix). The card
 * counterpart of WikiEntryDrawer: recall-test wiki-path hits can be manual
 * cards (spec §8 混排), and clicking one must open THIS drawer with the card
 * id — the wiki entry drawer 404s on card ids (「条目不存在或已删除」).
 * Same overlay rule: opening never switches the middle-column tab.
 */
export function ManualCardDrawer({
  kbId,
  cardId,
  open,
  onOpenChange,
}: {
  kbId: string | null;
  cardId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const tm = t.knowledge.manualCards;
  const tc = t.knowledge.chat;
  const query = useManualCard(open ? kbId : null, open ? cardId : null);
  const card = query.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle>{card?.title ?? tm.loading}</SheetTitle>
          {card && (
            <SheetDescription className="flex items-center gap-2">
              <Badge className="text-[10px]" variant="secondary">
                <StickyNote className="mr-1 size-3" />
                {tc.sourceTypeManual}
              </Badge>
              {card.include_in_wiki_search && (
                <Badge className="text-[10px]" variant="outline">
                  {tm.includeInSearch}
                </Badge>
              )}
              <span>
                {tm.updatedAt} {formatKnowledgeTimestamp(card.updated_at, locale)}
              </span>
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {query.isLoading && <p className="text-muted-foreground py-4 text-center text-xs">{tm.loading}</p>}
          {!query.isLoading && !card && (
            <p className="text-muted-foreground py-8 text-center text-sm">{tm.drawerNotFound}</p>
          )}
          {card && (
            <>
              {card.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {card.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-sm leading-6 whitespace-pre-wrap">{card.content}</p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
