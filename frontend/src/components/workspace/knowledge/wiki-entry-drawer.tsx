"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useWikiEntry } from "@/core/knowledge/hooks";

/**
 * Wiki entry full-text drawer (phase-2 batch-1). This is the *overlay* for
 * citation clicks: opening it never switches the middle-column tab, so the
 * reading context survives (验证性动作). The explicit 在百科 tab 中查看
 * button is the only path that navigates into the management view
 * (导航性动作).
 */
export function WikiEntryDrawer({
  kbId,
  entryId,
  open,
  onOpenChange,
  onRevealInTab,
}: {
  kbId: string | null;
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealInTab?: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const tw = t.knowledge.wikiDrawer;
  const query = useWikiEntry(open ? kbId : null, open ? entryId : null);
  const entry = query.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle>{entry?.title ?? tw.loading}</SheetTitle>
          {entry?.status === "dirty" && (
            <SheetDescription>{t.knowledge.wikiPanel.dirty}</SheetDescription>
          )}
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {query.isLoading && <p className="text-muted-foreground py-4 text-center text-xs">{tw.loading}</p>}
          {!query.isLoading && !entry && (
            <p className="text-muted-foreground py-8 text-center text-sm">{tw.notFound}</p>
          )}
          {entry && (
            <>
              <p className="text-sm leading-6 whitespace-pre-wrap">{entry.content}</p>
              {onRevealInTab && (
                <Button
                  className="self-start"
                  size="sm"
                  variant="outline"
                  onClick={() => onRevealInTab(entry.id)}
                >
                  {tw.openInTab}
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
