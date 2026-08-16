"use client";

import { BookOpen, ChevronDown, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { cn } from "@/lib/utils";

import { runAfterMenuClose } from "./run-after-menu-close";

/**
 * Wiki entries section of the wiki tab (split-section layout): a collapsible
 * section — default expanded — that shares the tab's unified search box with
 * the manual-cards section below. Filtering is client-side (the entries list
 * is a full collection); a non-empty query with matches force-expands the
 * section for the duration of the search. Rows carry the document-table
 * interaction model: checkbox multi-select + batch bar + batch delete (the
 * confirm copy keeps the regeneration semantics), and a right-click context
 * menu (open / edit / delete; batch variant inside a multi-selection). Row
 * click opens the right-side entry drawer.
 */
export function WikiPanel({
  entries,
  loading = false,
  updating = false,
  query = "",
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
  /** Unified wiki-tab search text (title + summary containment, client-side). */
  query?: string;
  onOpenEntry: (entry: WikiEntrySummary) => void;
  onDeleteEntry: (entry: WikiEntrySummary) => Promise<void> | void;
  /** Phase-3 Batch-1 P1: edit entry (opens WikiEditDialog) */
  onEditEntry?: (entry: WikiEntrySummary) => void;
}) {
  const { t, locale } = useI18n();
  const tk = t.knowledge;
  const tw = t.knowledge.wikiPanel;
  const [expanded, setExpanded] = useState(true);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // Batch delete reuses the single-entry confirm dialog with a target list.
  const [deleteTargets, setDeleteTargets] = useState<WikiEntrySummary[] | null>(null);

  // Filtering clears the selection so a bulk delete can never hit rows the
  // user can no longer see (same rule as the document table). Render-time
  // derived-state reset avoids an effect round-trip.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setSelectedIds(new Set());
  }

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(needle) || entry.summary.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  // 搜索期间有匹配 → 强制展开（用户收起优先让位于"看到搜索结果"）。
  const searching = query.trim() !== "";
  const effectiveExpanded = expanded || (searching && visibleEntries.length > 0);

  // Selection (checkbox model, same as the document table).
  const visibleIds = visibleEntries.map((entry) => entry.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const headerChecked = allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false;
  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };
  const toggleSelect = (entryId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  };
  // File-manager convention: right-clicking an unselected row selects just
  // that row; right-clicking a selected row keeps the batch context.
  const handleRowContextMenu = (entryId: string) => {
    if (!selectedIds.has(entryId)) {
      setSelectedIds(new Set([entryId]));
    }
  };
  const selectedEntries = () => entries.filter((entry) => selectedIds.has(entry.id));
  const confirmDeleteTargets = async () => {
    if (!deleteTargets) {
      return;
    }
    const removed = new Set(deleteTargets.map((entry) => entry.id));
    await Promise.allSettled(deleteTargets.map((entry) => Promise.resolve(onDeleteEntry(entry))));
    setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
    setDeleteTargets(null);
  };

  return (
    <section
      className={effectiveExpanded ? "flex min-h-0 flex-1 flex-col" : "flex shrink-0 flex-col"}
      data-testid="wiki-entries-section"
    >
      {/* Section header: collapse toggle + count + select-all checkbox. The
          toggle and the checkbox are siblings so neither nests in a button. */}
      <div className="flex shrink-0 items-center gap-1 pr-3">
        <button
          aria-expanded={effectiveExpanded}
          className="hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-4 py-2 text-left"
          data-testid="wiki-entries-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {effectiveExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="text-sm font-medium">{tw.sectionTitle}</span>
          <Badge className="ml-1" variant="secondary">
            {entries.length}
          </Badge>
        </button>
        {effectiveExpanded && visibleEntries.length > 0 && (
          <Checkbox
            aria-label={tk.selectAllDocuments}
            checked={headerChecked}
            onCheckedChange={toggleSelectAll}
          />
        )}
      </div>

      {updating && (
        <p
          className="text-muted-foreground flex shrink-0 items-center gap-1.5 px-4 pb-1 text-xs"
          data-testid="wiki-updating-hint"
        >
          <Loader2 className="size-3 animate-spin" />
          {tw.updatingHint}
        </p>
      )}

      {effectiveExpanded && (
        <>
          {selectedIds.size > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5" data-testid="wiki-batch-bar">
              <span className="min-w-0 flex-1 text-xs font-medium">
                {tk.selectedCount(selectedIds.size)}
              </span>
              <Button
                className="h-7"
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTargets(selectedEntries())}
              >
                <Trash2 className="size-3.5" />
                {tk.deleteSelected}
              </Button>
              <Button className="h-7" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                {tk.cancelSelection}
              </Button>
            </div>
          )}

          {loading && entries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.loading}</p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.empty}</p>
          ) : visibleEntries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.noMatches}</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="wiki-entry-list">
              {visibleEntries.map((entry) => {
                const isSelected = selectedIds.has(entry.id);
                return (
                  <li key={entry.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className={cn(
                            "group hover:bg-muted/50 relative flex items-start rounded-md",
                            isSelected && "bg-muted/60",
                          )}
                          data-selected={isSelected}
                          data-testid={`wiki-entry-row-${entry.id}`}
                          onContextMenu={() => handleRowContextMenu(entry.id)}
                        >
                          <Checkbox
                            aria-label={`${tw.selectEntry}: ${entry.title}`}
                            checked={isSelected}
                            className={cn(
                              "mt-3 ml-2 opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100",
                              selectedIds.size > 0 && "opacity-100",
                            )}
                            onCheckedChange={(checked) => toggleSelect(entry.id, checked === true)}
                          />
                          <button
                            className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-2 text-left"
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
                          {/* 操作区与标题行视觉同行：icon-sm（32px）+ top-1 → 按钮中心
                              ≈ 标题行中心。按钮仅在行 hover 时浮现，故右侧不留白、文字通栏。 */}
                          <div className="absolute top-1 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {onEditEntry && (
                              <Button
                                aria-label={tw.editEntry}
                                className="text-muted-foreground hover:text-primary"
                                size="icon-sm"
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
                              size="icon-sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTargets([entry]);
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        {isSelected && selectedIds.size > 1 ? (
                          <>
                            <ContextMenuLabel>{tk.selectedCount(selectedIds.size)}</ContextMenuLabel>
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() => runAfterMenuClose(() => setDeleteTargets(selectedEntries()))}
                            >
                              <Trash2 className="size-4" />
                              {tk.deleteSelected}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => setSelectedIds(new Set())}>
                              {tk.cancelSelection}
                            </ContextMenuItem>
                          </>
                        ) : (
                          <>
                            <ContextMenuItem onSelect={() => runAfterMenuClose(() => onOpenEntry(entry))}>
                              <BookOpen className="size-4" />
                              {tw.openEntry}
                            </ContextMenuItem>
                            {onEditEntry && (
                              <ContextMenuItem onSelect={() => runAfterMenuClose(() => onEditEntry(entry))}>
                                <Pencil className="size-4" />
                                {tw.editEntry}
                              </ContextMenuItem>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() => runAfterMenuClose(() => setDeleteTargets([entry]))}
                            >
                              <Trash2 className="size-4" />
                              {tw.deleteEntry}
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* Entry delete confirm (regeneration semantics in the copy; the title
          carries the count in the batch case) */}
      <Dialog open={deleteTargets !== null} onOpenChange={(open) => !open && setDeleteTargets(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {deleteTargets && deleteTargets.length > 1
                ? tw.deleteBatchTitle(deleteTargets.length)
                : tw.deleteConfirmTitle}
            </DialogTitle>
            <DialogDescription>{tw.deleteConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargets(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteTargets()}>
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
