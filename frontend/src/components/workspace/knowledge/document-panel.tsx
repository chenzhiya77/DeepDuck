"use client";

import { BookOpen, FileText, MoreHorizontal, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import { aggregateDocumentStats, formatBytes } from "@/core/knowledge/document-stats";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeDocumentStatus } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

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
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  const stats = aggregateDocumentStats(documents);
  const statusText = (status: KnowledgeDocumentStatus) => tk.status[status] ?? status;

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
                  setRenameOpen(true);
                }}
              >
                {tk.renameKb}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleteKbOpen(true)}>
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

      {/* Document table (horizontal scroll protects the six columns on narrow widths) */}
      <div className="min-h-0 flex-1 overflow-auto">
        {documents.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tk.emptyDocuments}</p>
        ) : (
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">{tk.table.name}</th>
                <th className="px-2 py-2 font-medium">{tk.table.uploader}</th>
                <th className="px-2 py-2 font-medium">{tk.table.size}</th>
                <th className="px-2 py-2 font-medium">{tk.table.chunks}</th>
                <th className="px-2 py-2 font-medium">{tk.table.status}</th>
                <th className="px-2 py-2 font-medium">{tk.table.createdAt}</th>
                <th className="px-2 py-2 font-medium">{tk.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  className="hover:bg-muted/50 cursor-pointer border-b last:border-0"
                  onClick={() => onOpenChunks(doc)}
                >
                  <td className="max-w-48 px-4 py-2">
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
                        onClick={() => setDeleteDocId(doc.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
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
      <Dialog open={deleteDocId !== null} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.deleteDocumentConfirmTitle}</DialogTitle>
            <DialogDescription>{tk.deleteDocumentConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocId(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteDocId) {
                  void onDeleteDocument(deleteDocId);
                }
                setDeleteDocId(null);
              }}
            >
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
