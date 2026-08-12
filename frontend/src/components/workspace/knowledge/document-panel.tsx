"use client";

import { ArrowUpDown, Check, FileText, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { aggregateDocumentStats, formatBytes } from "@/core/knowledge/document-stats";
import {
  DEFAULT_DOCUMENT_SORT,
  filterDocuments,
  sortDocuments,
  type DocumentSortKey,
  type SortDirection,
} from "@/core/knowledge/document-view";
import { formatKnowledgeTimestamp } from "@/core/knowledge/format";
import { pathStatusLines } from "@/core/knowledge/path-status";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeDocumentStatus } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { runAfterMenuClose } from "./run-after-menu-close";

const SORT_OPTIONS: { key: DocumentSortKey; labelKey: "createdAt" | "name" | "size" | "chunks" }[] = [
  { key: "created_at", labelKey: "createdAt" },
  { key: "name", labelKey: "name" },
  { key: "size_bytes", labelKey: "size" },
  { key: "chunk_count", labelKey: "chunks" },
];

const STATUS_BADGE_VARIANT: Record<KnowledgeDocumentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  uploaded: "outline",
  parsing: "secondary",
  chunking: "secondary",
  indexing: "secondary",
  ready: "default",
  failed: "destructive",
};

/**
 * Hover breakdown for the status column (P3, spec 2026-08-11 §5): three
 * per-path lines — vector / graph (percent combined mid-indexing) / wiki.
 * The wiki line carries the library-level hint because it is a library-wide
 * mirror, not a per-document state. Exported for dom tests.
 */
export function PathStatusBreakdown({
  doc,
}: {
  doc: Pick<KnowledgeDocument, "path_status" | "progress_percent" | "status">;
}) {
  const { t } = useI18n();
  const ps = t.knowledge.pathStatus;
  const lines = pathStatusLines(doc);
  if (!lines) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1" data-testid="path-status-breakdown">
      {lines.map((line) => (
        <div key={line.path} className="flex items-center justify-between gap-4 text-xs">
          <span className="text-muted-foreground">
            {ps[line.path]}
            {line.path === "wiki" ? ps.libraryHint : ""}
          </span>
          <span>
            {ps.state[line.state as keyof typeof ps.state] ?? line.state}
            {line.percent !== undefined ? ` ${line.percent}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Documents pane of the middle column (spec §5.2/§3.6). Presentational: the
 * page owns data fetching, polling (via `useDocuments`), and mutations.
 * Library-level actions (rename/delete/generate wiki) live in the
 * `MiddleTabs` header row — this pane owns document actions only (upload,
 * search/sort, row operations).
 */
export function DocumentPanel({
  kb,
  documents,
  onUpload,
  onDeleteDocument,
  onRetryDocument,
  onOpenChunks,
}: {
  kb: KnowledgeBase;
  documents: KnowledgeDocument[];
  onUpload: (files: File[]) => void;
  onDeleteDocument: (docId: string) => Promise<void> | void;
  onRetryDocument: (docId: string) => void;
  onOpenChunks: (doc: KnowledgeDocument) => void;
}) {
  const { t, locale } = useI18n();
  const tk = t.knowledge;
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: DocumentSortKey; direction: SortDirection }>(DEFAULT_DOCUMENT_SORT);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // Batch delete reuses the single-doc confirm dialog with a target list.
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);

  const stats = aggregateDocumentStats(documents);
  const statusText = (status: KnowledgeDocumentStatus) => tk.status[status] ?? status;
  // The list endpoint returns the full collection, so the toolbar filter and
  // sort stay client-side (spec §5.2); the stats row always aggregates the
  // unfiltered list.
  const visibleDocuments = useMemo(
    () => sortDocuments(filterDocuments(documents, query), sort.key, sort.direction),
    [documents, query, sort],
  );

  // Selection (checkbox model, spec §5.2): filtering clears it so a bulk
  // delete can never hit rows the user can no longer see.
  const updateQuery = (value: string) => {
    setQuery(value);
    setSelectedIds(new Set());
  };
  const visibleIds = visibleDocuments.map((doc) => doc.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const headerChecked = allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false;
  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };
  const toggleSelect = (docId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(docId);
      } else {
        next.delete(docId);
      }
      return next;
    });
  };
  // File-manager convention: right-clicking an unselected row selects just
  // that row; right-clicking a selected row keeps the batch context.
  const handleRowContextMenu = (docId: string) => {
    if (!selectedIds.has(docId)) {
      setSelectedIds(new Set([docId]));
    }
  };
  const confirmDeleteTargets = async () => {
    if (!deleteTargets) {
      return;
    }
    const removed = new Set(deleteTargets);
    await Promise.allSettled(
      deleteTargets.map((id) => Promise.resolve(onDeleteDocument(id))),
    );
    setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
    setDeleteTargets(null);
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    onUpload(Array.from(files));
  };

  return (
    <div
      className={cn("relative flex h-full flex-col", dragActive && "bg-muted/40")}
      data-testid="document-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        handleFiles(event.dataTransfer?.files ?? null);
      }}
    >
      {/* The library header row (kb name + overflow menu incl. upload)
          lives in `MiddleTabs`; this pane starts at its own toolbar.
          Dragging files anywhere onto this pane also uploads. */}

      {/* Drop feedback overlay: makes the drop affordance explicit while a
          file hovers over the panel (the root bg tint alone is too subtle). */}
      {dragActive && (
        <div
          className="bg-background/70 pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed"
          data-testid="document-drop-overlay"
        >
          <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <Upload className="size-4" />
            {tk.dropToUpload}
          </p>
        </div>
      )}

      {/* Toolbar: batch actions while selecting, otherwise the name filter
          and the sort dropdown (client-side view controls; upload lives in
          the library menu so this row stays lean) */}
      {selectedIds.size > 0 ? (
        <div className="flex items-center gap-2 border-b px-4 py-2" data-testid="document-batch-bar">
          <span className="min-w-0 flex-1 text-xs font-medium">
            {tk.selectedCount(selectedIds.size)}
          </span>
          <Button
            className="h-7"
            size="sm"
            variant="destructive"
            onClick={() => setDeleteTargets([...selectedIds])}
          >
            <Trash2 className="size-3.5" />
            {tk.deleteSelected}
          </Button>
          <Button className="h-7" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            {tk.cancelSelection}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              aria-label={tk.searchDocuments}
              className="h-7 pr-7 pl-7 text-xs"
              placeholder={tk.searchDocuments}
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
            />
            {query && (
              <button
                aria-label={tk.clearSearch}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
                type="button"
                onClick={() => updateQuery("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={tk.sortDocuments} size="icon-sm" variant="ghost">
              <ArrowUpDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>{tk.sortDocuments}</DropdownMenuLabel>
            {SORT_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.key}
                onSelect={() => setSort((current) => ({ ...current, key: option.key }))}
              >
                <Check className={cn("size-4", sort.key !== option.key && "invisible")} />
                {tk.sort[option.labelKey]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {(["asc", "desc"] as const).map((direction) => (
              <DropdownMenuItem
                key={direction}
                onSelect={() => setSort((current) => ({ ...current, direction }))}
              >
                <Check className={cn("size-4", sort.direction !== direction && "invisible")} />
                {tk.sort[direction]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      )}

      {/* Document table (horizontal scroll protects the six columns on narrow widths) */}
      <div className="min-h-0 flex-1 overflow-auto">
        {documents.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tk.emptyDocuments}</p>
        ) : visibleDocuments.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tk.noMatchingDocuments}</p>
        ) : (
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs whitespace-nowrap">
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    aria-label={tk.selectAllDocuments}
                    checked={headerChecked}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-2 py-2 font-medium">{tk.table.name}</th>
                <th className="px-2 py-2 font-medium">{tk.table.uploader}</th>
                <th className="px-2 py-2 font-medium">{tk.table.size}</th>
                <th className="px-2 py-2 font-medium">{tk.table.chunks}</th>
                <th className="px-2 py-2 font-medium">{tk.table.status}</th>
                <th className="px-2 py-2 font-medium">{tk.table.createdAt}</th>
                <th className="px-2 py-2 font-medium">{tk.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((doc) => {
                const isSelected = selectedIds.has(doc.id);
                return (
                  <ContextMenu key={doc.id}>
                    <ContextMenuTrigger asChild>
                      <tr
                        className={cn(
                          "group hover:bg-muted/50 cursor-pointer border-b last:border-0",
                          isSelected && "bg-muted/60",
                        )}
                        data-selected={isSelected}
                        onClick={() => onOpenChunks(doc)}
                        onContextMenu={() => handleRowContextMenu(doc.id)}
                      >
                        <td className="w-8 px-2 py-2" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label={`${tk.selectDocument}: ${doc.name}`}
                            checked={isSelected}
                            className={cn(
                              "opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100",
                              selectedIds.size > 0 && "opacity-100",
                            )}
                            onCheckedChange={(checked) => toggleSelect(doc.id, checked === true)}
                          />
                        </td>
                        <td className="max-w-48 px-2 py-2">
                          <div className="flex items-center gap-2">
                            <FileText className="text-muted-foreground size-4 shrink-0" />
                            <span className="truncate">{doc.name}</span>
                          </div>
                        </td>
                  <td className="text-muted-foreground px-2 py-2">
                    {doc.uploader_id === kb.owner_id ? tk.uploaderMe : doc.uploader_id}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">{formatBytes(doc.size_bytes)}</td>
                  <td className="text-muted-foreground px-2 py-2">{doc.chunk_count ?? "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-0.5">
                      {(() => {
                        const statusIndicator = (
                          <span
                            className="flex w-fit items-center gap-1.5"
                            data-testid={doc.path_status ? "path-status-trigger" : undefined}
                          >
                            <Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? "outline"}>{statusText(doc.status)}</Badge>
                            {/* 百分比只在 indexing 显示——前置阶段（解析/切片）无可测进度，不挂无信息量的 0% */}
                            {doc.status === "indexing" && (
                              <span className="text-muted-foreground text-xs">{doc.progress_percent}%</span>
                            )}
                          </span>
                        );
                        // P3：path_status 非 null 才挂悬停（老行/未进索引不展示）
                        return doc.path_status ? (
                          <Tooltip content={<PathStatusBreakdown doc={doc} />}>{statusIndicator}</Tooltip>
                        ) : (
                          statusIndicator
                        );
                      })()}
                      {doc.error && (
                        <span className="text-destructive max-w-56 truncate text-xs" title={doc.error}>
                          {doc.error}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">
                    {formatKnowledgeTimestamp(doc.created_at, locale)}
                  </td>
                  <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {doc.status === "failed" && (
                        <Button size="sm" variant="ghost" onClick={() => onRetryDocument(doc.id)}>
                          <RotateCcw className="size-3.5" />
                          {tk.retryDocument}
                        </Button>
                      )}
                      <Button
                        aria-label={tk.deleteDocument}
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTargets([doc.id])}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                      </tr>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44">
                      {isSelected && selectedIds.size > 1 ? (
                        <>
                          <ContextMenuLabel>{tk.selectedCount(selectedIds.size)}</ContextMenuLabel>
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => runAfterMenuClose(() => setDeleteTargets([...selectedIds]))}
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
                          <ContextMenuItem onSelect={() => runAfterMenuClose(() => onOpenChunks(doc))}>
                            <FileText className="size-4" />
                            {tk.openChunks}
                          </ContextMenuItem>
                          {doc.status === "failed" && (
                            <ContextMenuItem onSelect={() => onRetryDocument(doc.id)}>
                              <RotateCcw className="size-4" />
                              {tk.retryDocument}
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => runAfterMenuClose(() => setDeleteTargets([doc.id]))}
                          >
                            <Trash2 className="size-4" />
                            {tk.deleteDocument}
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom stats row (spec §3.6, aggregated client-side) */}
      <div className="text-muted-foreground border-t px-4 py-2 text-xs" data-testid="document-stats-row">
        {tk.statsDocuments} {stats.total} · {tk.statsChunks} {stats.totalChunks} · {formatBytes(stats.totalBytes)} ·{" "}
        {tk.statsReady} {stats.ready} · {tk.statsIndexing} {stats.inProgress} · {tk.statsFailed} {stats.failed}
      </div>

      {/* Document delete confirm */}
      <Dialog open={deleteTargets !== null} onOpenChange={(open) => !open && setDeleteTargets(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.deleteDocumentConfirmTitle}</DialogTitle>
            <DialogDescription>{tk.deleteDocumentConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargets(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteTargets()}
            >
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
