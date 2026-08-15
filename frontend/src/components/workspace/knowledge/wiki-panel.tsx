"use client";

import { BookOpen, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { formatKnowledgeTimestamp } from "@/core/knowledge/format";
import type { WikiEntrySummary } from "@/core/knowledge/types";

/**
 * Wiki entries list (phase-2 batch-1; Task 13 added per-row delete): title +
 * summary + dirty badge + updated time. Row click opens the right-side entry
 * drawer; the drawer owns the full-text fetch. Row hover reveals the delete
 * action behind a confirm dialog whose copy states the regeneration
 * semantics: an eligible entity's entry comes back on the next generation
 * run (a reset), only a disqualified/vanished entity's entry stays deleted.
 */
export function WikiPanel({
  entries,
  loading = false,
  updating = false,
  onOpenEntry,
  onDeleteEntry,
  onEditEntry,
}: {
  entries: WikiEntrySummary[];
  loading?: boolean;
  /**
   * Wiki 更新状态可见 (2026-08-14): a generation run is in flight — the
   * hint line stays up and dirty badges switch to 更新中 until the run
   * drains (the entries query polls while the backend reports generating).
   */
  updating?: boolean;
  onOpenEntry: (entry: WikiEntrySummary) => void;
  onDeleteEntry: (entry: WikiEntrySummary) => void;
  /** Phase-3 Batch-1 P1: edit entry (opens WikiEditDialog) */
  onEditEntry?: (entry: WikiEntrySummary) => void;
}) {
  const { t, locale } = useI18n();
  const tw = t.knowledge.wikiPanel;
  const [deleteTarget, setDeleteTarget] = useState<WikiEntrySummary | null>(null);

  if (loading && entries.length === 0) {
    return <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.loading}</p>;
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.empty}</p>;
  }

  return (
    <>
      {updating && (
        <p
          className="text-muted-foreground flex items-center gap-1.5 px-4 pt-2 text-xs"
          data-testid="wiki-updating-hint"
        >
          <Loader2 className="size-3 animate-spin" />
          {tw.updatingHint}
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="wiki-entry-list">
        {entries.map((entry) => (
          <li className="group relative" key={entry.id}>
            <button
              className="hover:bg-muted/50 flex w-full flex-col gap-1 rounded-md px-2 py-2 pr-9 text-left"
              type="button"
              onClick={() => onOpenEntry(entry)}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 truncate text-sm font-medium">{entry.title}</span>
                {entry.status === "dirty" && (
                  <Badge className="shrink-0 gap-1" variant="secondary">
                    {updating && <Loader2 className="size-3 animate-spin" />}
                    {updating ? tw.updating : tw.dirty}
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground line-clamp-2 pl-6 text-xs">{entry.summary}</span>
              <span className="text-muted-foreground pl-6 text-xs">
                {tw.updatedAt} {formatKnowledgeTimestamp(entry.updated_at, locale)}
              </span>
            </button>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {onEditEntry && (
                <Button
                  aria-label="编辑条目"
                  className="text-muted-foreground hover:text-primary"
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditEntry(entry);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
              <Button
                aria-label={tw.deleteEntry}
                className="text-muted-foreground hover:text-destructive"
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(entry);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {/* Entry delete confirm (regeneration semantics in the copy) */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tw.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{tw.deleteConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  onDeleteEntry(deleteTarget);
                }
                setDeleteTarget(null);
              }}
            >
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
