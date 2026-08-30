"use client";

import {
  ArrowUpDown,
  Check,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Presentation,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { classifyDocError } from "@/core/knowledge/doc-errors";
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
import { partitionFilesBySuffix } from "@/core/knowledge/supported-formats";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeDocumentStatus } from "@/core/knowledge/types";
import type { DocFailureEntry } from "@/core/knowledge/use-doc-failure-notifier";
import { cn } from "@/lib/utils";

import { DocFailurePanel } from "./doc-failure-panel";
import { runAfterMenuClose } from "./run-after-menu-close";

const SORT_OPTIONS: { key: DocumentSortKey; labelKey: "createdAt" | "name" | "size" | "chunks" }[] = [
  { key: "created_at", labelKey: "createdAt" },
  { key: "name", labelKey: "name" },
  { key: "size_bytes", labelKey: "size" },
  { key: "chunk_count", labelKey: "chunks" },
];

// 状态指示（2026-08-30）：圆点 + 小字（Linear 风格）替代实心徽章——
// 文件名是第一扫描目标，常态退后、异常突出：就绪绿点退背景，
// 进行中琥珀，失败红点红字是唯一抢眼态。原黑底 default Badge 已移除。
const STATUS_DOT_CLASS: Record<KnowledgeDocumentStatus, string> = {
  uploaded: "bg-muted-foreground/60",
  parsing: "bg-amber-500",
  chunking: "bg-amber-500",
  indexing: "bg-amber-500",
  ready: "bg-emerald-500",
  failed: "bg-destructive",
};

// 文件类型图标（2026-08-30）：形状 + 颜色双区分，色系对齐主流文件管理器
// （Drive/OneDrive：PDF 红、Word 蓝、PPT 橙、表格绿、图片紫）。
const FILE_TYPE_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  ".pdf": { icon: FileText, className: "text-red-500" },
  ".doc": { icon: FileType2, className: "text-blue-500" },
  ".docx": { icon: FileType2, className: "text-blue-500" },
  ".ppt": { icon: Presentation, className: "text-orange-500" },
  ".pptx": { icon: Presentation, className: "text-orange-500" },
  ".csv": { icon: FileSpreadsheet, className: "text-emerald-500" },
  ".md": { icon: FileCode2, className: "text-sky-500" },
  ".markdown": { icon: FileCode2, className: "text-sky-500" },
  ".txt": { icon: FileText, className: "text-muted-foreground" },
  ".png": { icon: FileImage, className: "text-violet-500" },
  ".jpg": { icon: FileImage, className: "text-violet-500" },
  ".jpeg": { icon: FileImage, className: "text-violet-500" },
};

/** 后缀小写匹配；未知类型回退通用图标 + 次要色（不假装有类型信息）。 */
function fileTypeStyle(fileName: string): { icon: LucideIcon; className: string } {
  const suffix = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return FILE_TYPE_STYLE[suffix] ?? { icon: File, className: "text-muted-foreground" };
}

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
  supportedSuffixes,
  failures = [],
  onDismissFailure = () => undefined,
  onDismissAllFailures = () => undefined,
}: {
  kb: KnowledgeBase;
  documents: KnowledgeDocument[];
  onUpload: (files: File[]) => void;
  onDeleteDocument: (docId: string) => Promise<void> | void;
  onRetryDocument: (docId: string) => void;
  onOpenChunks: (doc: KnowledgeDocument) => void;
  /** Upload allowlist (Task 6, spec §6): drag-drop pre-upload intercept. */
  supportedSuffixes: readonly string[];
  /** 失败通知面板（2026-08-31）：状态在页面层（useDocFailureNotifier），
      本层只负责渲染在 tab 内右下角——全局 toast 已退出文档错误链路。 */
  failures?: DocFailureEntry[];
  onDismissFailure?: (key: string) => void;
  onDismissAllFailures?: () => void;
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
    // Task 6: pre-upload allowlist intercept for drag-drop (no picker gate here).
    const { accepted, rejected } = partitionFilesBySuffix(Array.from(files), supportedSuffixes);
    if (rejected.length > 0) {
      toast.error(tk.unsupportedFilesSkipped(rejected.map((f) => f.name).join(", ")));
    }
    if (accepted.length > 0) {
      onUpload(accepted);
    }
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
            {/* size-7（28px）与搜索框 h-7 同高——icon-sm（32px）会把工具栏
                撑得比 wiki tab 搜索栏高 4px。 */}
            <Button aria-label={tk.sortDocuments} className="size-7" size="icon-sm" variant="ghost">
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
                <th className="px-2 py-2 font-medium">{tk.table.status}</th>
                <th className="px-2 py-2 font-medium">{tk.table.createdAt}</th>
                {/* 数值列聚右组（2026-08-30）：表头同轴右对齐 + tabular-nums，
                    文本列居左、大小/数量靠右——主流文件管理器惯例 */}
                <th className="px-2 py-2 text-right font-medium tabular-nums">{tk.table.size}</th>
                <th className="px-2 py-2 text-right font-medium tabular-nums">{tk.table.chunks}</th>
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
                            {/* 类型图标：形状+颜色双区分，扫描定位更快（2026-08-30） */}
                            {(() => {
                              const { icon: TypeIcon, className: typeClass } = fileTypeStyle(doc.name);
                              return <TypeIcon className={cn("size-4 shrink-0", typeClass)} />;
                            })()}
                            <span className="truncate">{doc.name}</span>
                          </div>
                        </td>
                  <td className="text-muted-foreground px-2 py-2">
                    {doc.uploader_id === kb.owner_id ? tk.uploaderMe : doc.uploader_id}
                  </td>
                  {/* 状态单元格单行（2026-08-31）：错误行已删，不再需要 flex-col 叠放，
                      nowrap 防换行（图 1 反馈失败行被撑高）；失败态重试收进悬停卡片 */}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {(() => {
                        const statusIndicator = (
                          <span
                            className="flex w-fit items-center gap-1.5"
                            data-testid={doc.path_status ? "path-status-trigger" : undefined}
                          >
                            {/* 圆点+小字替代实心徽章（2026-08-30）：就绪退背景，失败红字唯一抢眼 */}
                            <span
                              aria-hidden
                              className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[doc.status] ?? "bg-muted-foreground/60")}
                            />
                            <span className={cn("text-xs", doc.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                              {statusText(doc.status)}
                            </span>
                            {/* 百分比只在 indexing 显示——前置阶段（解析/切片）无可测进度，不挂无信息量的 0% */}
                            {doc.status === "indexing" && (
                              <span className="text-muted-foreground text-xs">{doc.progress_percent}%</span>
                            )}
                          </span>
                        );
                        // 失败态（2026-08-31）：重试不占操作列，悬停失败状态出卡片——
                        // 友好原因 + 重试按钮（HoverCard 支持交互内容，Tooltip 不支持）；
                        // 右键菜单仍保留重试兜底（既有）。
                        if (doc.status === "failed") {
                          return (
                            <HoverCard closeDelay={200} openDelay={150}>
                              <HoverCardTrigger asChild>
                                <span className="cursor-default" data-testid="doc-retry-trigger">
                                  {statusIndicator}
                                </span>
                              </HoverCardTrigger>
                              <HoverCardContent align="start" className="w-60 p-3" data-testid="doc-retry-card" side="top">
                                <p className="text-muted-foreground mb-2 text-xs">
                                  {tk.docErrors[classifyDocError(doc.error)]}
                                </p>
                                <Button className="h-7 gap-1.5 px-2.5" size="sm" onClick={() => onRetryDocument(doc.id)}>
                                  <RotateCcw className="size-3.5" />
                                  {tk.retryDocument}
                                </Button>
                              </HoverCardContent>
                            </HoverCard>
                          );
                        }
                        // P3：path_status 非 null 才挂悬停（老行/未进索引不展示）
                        return doc.path_status ? (
                          <Tooltip content={<PathStatusBreakdown doc={doc} />}>{statusIndicator}</Tooltip>
                        ) : (
                          statusIndicator
                        );
                      })()}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">
                    {formatKnowledgeTimestamp(doc.created_at, locale)}
                  </td>
                  {/* 数值列右对齐（2026-08-30）：整串右对齐使单位（KB/MB）右缘成列；
                      tabular-nums 等宽数字避免参差 */}
                  <td className="text-muted-foreground px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatBytes(doc.size_bytes)}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-right tabular-nums">
                    {doc.chunk_count ?? "—"}
                  </td>
                  <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {/* 操作列全行统一（2026-08-31）：仅删除；重试不占列宽，
                          走失败状态悬停卡片与右键菜单，行高形态不再因失败行突变 */}
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

      {/* 失败通知面板（2026-08-31）：绝对定位在 tab 内右下角，不跑到文档 tab 外侧；
          面板内重试复用行级 onRetryDocument（条目 key 即文档 id） */}
      <DocFailurePanel
        failures={failures}
        onDismiss={onDismissFailure}
        onDismissAll={onDismissAllFailures}
        onRetry={onRetryDocument}
      />
    </div>
  );
}
