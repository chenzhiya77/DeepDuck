"use client";

import { ArrowUpDown, BookOpen, Check, FileText, MoreHorizontal, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

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
import { useI18n } from "@/core/i18n/hooks";
import { aggregateDocumentStats, formatBytes } from "@/core/knowledge/document-stats";
import {
  DEFAULT_DOCUMENT_SORT,
  filterDocuments,
  sortDocuments,
  type DocumentSortKey,
  type SortDirection,
} from "@/core/knowledge/document-view";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeDocumentStatus } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

const SORT_OPTIONS: { key: DocumentSortKey; labelKey: "createdAt" | "name" | "size" | "chunks" }[] = [
  { key: "created_at", labelKey: "createdAt" },
  { key: "name", labelKey: "name" },
  { key: "size_bytes", labelKey: "size" },
  { key: "chunk_count", labelKey: "chunks" },
];

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const STATUS_BADGE_VARIANT: Record<KnowledgeDocumentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  uploaded: "outline",
  parsing: "secondary",
  chunking: "secondary",
  indexing: "secondary",
  ready: "default",
  failed: "destructive",
};

/**
 * Defer an action until the Radix menu (dropdown/context) has fully torn down
 * its dismissal layer — exit animation finished and the body pointer-events
 * restored. Opening a second modal layer (rename/delete dialog, chunk drawer)
 * synchronously from onSelect interleaves both layers' body pointer-events
 * bookkeeping in react-dismissable-layer, leaving `pointer-events: none`
 * stuck on <body> after the second layer closes: the page then looks frozen
 * and only a refresh recovers (right-click → 查看切片 → click outside
 * reproduces it). Poll instead of a fixed timeout so we don't guess the
 * animation length; the deadline keeps the action alive if the menu never
 * settles (e.g. happy-dom).
 */
function runAfterMenuClose(action: () => void) {
  const deadline = Date.now() + 500;
  const tick = () => {
    if (document.body.style.pointerEvents !== "none" || Date.now() > deadline) {
      action();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Middle column of the knowledge page (spec §5.2/§3.6). Presentational: the
 * page owns data fetching, polling (via `useDocuments`), and mutations.
 */
export function DocumentPanel({
  kb,
  documents,
  uploading = false,
  onUpload,
  onGenerateWiki,
  onRenameKb,
  onDeleteKb,
  onDeleteDocument,
  onRetryDocument,
  onOpenChunks,
}: {
  kb: KnowledgeBase;
  documents: KnowledgeDocument[];
  uploading?: boolean;
  onUpload: (files: File[]) => void;
  onGenerateWiki: () => void;
  onRenameKb: (name: string) => Promise<void> | void;
  onDeleteKb: () => Promise<void> | void;
  onDeleteDocument: (docId: string) => Promise<void> | void;
  onRetryDocument: (docId: string) => void;
  onOpenChunks: (doc: KnowledgeDocument) => void;
}) {
  const { t, locale } = useI18n();
  const tk = t.knowledge;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(kb.name);
  const [deleteKbOpen, setDeleteKbOpen] = useState(false);
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
      {/* Header: kb name + type tag only; every library action (upload,
          generate wiki, rename, delete, and future ones) lives in the ⋯
          overflow menu so the header stays one stable line (spec §5.2).
          Dragging files anywhere onto this panel also uploads. */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{kb.name}</h2>
        <Badge className="shrink-0" variant="outline">{t.knowledge.personalKBs}</Badge>
        <div className="ml-auto flex shrink-0 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={tk.settings} size="sm" variant="ghost">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={uploading}
                onSelect={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" />
                {uploading ? tk.uploadingDocuments : tk.uploadDocuments}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onGenerateWiki}>
                <BookOpen className="size-4" />
                {tk.generateWiki}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(kb.name);
                  runAfterMenuClose(() => setRenameOpen(true));
                }}
              >
                {tk.renameKb}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => runAfterMenuClose(() => setDeleteKbOpen(true))}>
                {tk.deleteKb}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <input
          ref={fileInputRef}
          multiple
          className="hidden"
          data-testid="document-upload-input"
          type="file"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

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
          and sort dropdown (client-side view controls) */}
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
                      <span className="flex items-center gap-1.5">
                        <Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? "outline"}>{statusText(doc.status)}</Badge>
                        {doc.status !== "ready" && doc.status !== "failed" && (
                          <span className="text-muted-foreground text-xs">{doc.progress_percent}%</span>
                        )}
                      </span>
                      {doc.error && (
                        <span className="text-destructive max-w-56 truncate text-xs" title={doc.error}>
                          {doc.error}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">
                    {formatTimestamp(doc.created_at, locale)}
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

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.renameKb}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                void onRenameKb(renameValue.trim());
                setRenameOpen(false);
              }}
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KB delete confirm (cascade warning, spec §3.7) */}
      <Dialog open={deleteKbOpen} onOpenChange={setDeleteKbOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.deleteKbConfirmTitle}</DialogTitle>
            <DialogDescription>{tk.deleteKbConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteKbOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onDeleteKb();
                setDeleteKbOpen(false);
              }}
            >
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
