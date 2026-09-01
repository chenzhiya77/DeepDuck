"use client";

import {
  ArrowUpDown,
  Check,
  FileText,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { classifyDocError } from "@/core/knowledge/doc-errors";
import {
  aggregateDocumentStats,
  formatBytes,
  formatKb,
} from "@/core/knowledge/document-stats";
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
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeDocumentStatus,
} from "@/core/knowledge/types";
import type { DocFailureEntry } from "@/core/knowledge/use-doc-failure-notifier";
import { cn } from "@/lib/utils";

import { DocFailurePanel } from "./doc-failure-panel";
import { FileTypeBadge, fileTypeKind, probeDraggedItems, probeSignature, type DragProbe } from "./file-type-badge";
import { runAfterMenuClose } from "./run-after-menu-close";

const SORT_OPTIONS: {
  key: DocumentSortKey;
  labelKey: "createdAt" | "name" | "size" | "chunks";
}[] = [
  { key: "created_at", labelKey: "createdAt" },
  { key: "name", labelKey: "name" },
  { key: "size_bytes", labelKey: "size" },
  { key: "chunk_count", labelKey: "chunks" },
];

// 状态指示（2026-08-30）：圆点 + 小字（Linear 风格）替代实心徽章——
// 文件名是第一扫描目标，常态退后、异常突出。原黑底 default Badge 已移除。
// 就绪降不透明度而非加深：加深会抬高对比、更抢眼，与「常态退后」正好相反。
const STATUS_DOT_CLASS: Record<KnowledgeDocumentStatus, string> = {
  uploaded: "bg-muted-foreground/60",
  parsing: "bg-amber-500",
  chunking: "bg-amber-500",
  indexing: "bg-amber-500",
  ready: "bg-emerald-500/45",
  failed: "bg-destructive",
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
        <div
          key={line.path}
          className="flex items-center justify-between gap-4 text-xs"
        >
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
/** One filename per badge kind — the empty state's nine-grid doubles as a
 * quiet "all these formats are welcome" hint. `readme` (no suffix) lands on
 * the muted unknown sheet so the grid ends soft instead of loud. */
const EMPTY_STATE_SAMPLES = [
  "report.pdf",
  "notes.docx",
  "data.xlsx",
  "deck.pptx",
  "app.py",
  "photo.png",
  "video.mp4",
  "bundle.zip",
  "readme",
];

/**
 * 空态（2026-09-01）：降调九宫格 + 一句短文案，克制不抢戏（上传入口留在库菜单与整面拖放）。
 * 九宫格默认半透明垫场，悬停恢复全彩并上浮一格（彩蛋）。
 * 拖入识别双态（probe）：接受类型对应图标放大点亮；全部被拒时整体降灰，
 * 放下前就告知结果，不白跑一次上传。
 */
function EmptyDocumentsState({ probe }: { probe: DragProbe | null }) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const lit = probe ? new Set(probe.litKinds) : null;
  const dimAll = probe !== null && !probe.anyAccepted;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <div className="grid grid-cols-3 gap-3" data-testid="empty-doc-icons">
        {EMPTY_STATE_SAMPLES.map((name) => {
          const isLit = lit?.has(fileTypeKind(name)) ?? false;
          return (
            <FileTypeBadge
              key={name}
              fileName={name}
              className={cn(
                "size-8 cursor-default transition-all duration-150",
                // 静态态：半透明垫场 + 悬停彩蛋。
                probe === null && "opacity-60 hover:-translate-y-1 hover:opacity-100",
                // 拖入态：点亮的放大全彩，其余（或全拒时全部）降灰。
                probe !== null && (dimAll || !isLit) && "opacity-25",
                probe !== null && !dimAll && isLit && "scale-125 opacity-100",
              )}
            />
          );
        })}
      </div>
      <p className="text-muted-foreground text-sm">{tk.emptyDocuments}</p>
    </div>
  );
}

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
  // Drag-in type probe: which kinds light up / whether the batch is rejected.
  const [dragProbe, setDragProbe] = useState<DragProbe | null>(null);
  const probeKeyRef = useRef("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{
    key: DocumentSortKey;
    direction: SortDirection;
  }>(DEFAULT_DOCUMENT_SORT);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Batch delete reuses the single-doc confirm dialog with a target list.
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);

  const stats = aggregateDocumentStats(documents);
  const statusText = (status: KnowledgeDocumentStatus) =>
    tk.status[status] ?? status;
  // The list endpoint returns the full collection, so the toolbar filter and
  // sort stay client-side (spec §5.2); the stats row always aggregates the
  // unfiltered list.
  const visibleDocuments = useMemo(
    () =>
      sortDocuments(
        filterDocuments(documents, query),
        sort.key,
        sort.direction,
      ),
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
  const headerChecked = allVisibleSelected
    ? true
    : someVisibleSelected
      ? "indeterminate"
      : false;
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
    setSelectedIds(
      (current) => new Set([...current].filter((id) => !removed.has(id))),
    );
    setDeleteTargets(null);
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    // Task 6: pre-upload allowlist intercept for drag-drop (no picker gate here).
    const { accepted, rejected } = partitionFilesBySuffix(
      Array.from(files),
      supportedSuffixes,
    );
    if (rejected.length > 0) {
      toast.error(
        tk.unsupportedFilesSkipped(rejected.map((f) => f.name).join(", ")),
      );
    }
    if (accepted.length > 0) {
      onUpload(accepted);
    }
  };

  return (
    <div
      className={cn(
        "relative flex h-full flex-col",
        dragActive && "bg-muted/40",
      )}
      data-testid="document-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
        // Type probe: dragover exposes item MIME types, so the nine-grid
        // can light/dim before anything is dropped. dragover fires on every
        // mouse move — only a changed verdict re-renders. Drags with no file
        // items (dragged text/links) get no verdict at all.
        const probe = probeDraggedItems(event.dataTransfer?.items, supportedSuffixes);
        const verdict = probe.anyAccepted || probe.anyRejected ? probe : null;
        const key = probeSignature(verdict);
        if (key !== probeKeyRef.current) {
          probeKeyRef.current = key;
          setDragProbe(verdict);
        }
      }}
      onDragLeave={(event) => {
        // 只有真正离开面板才复位——在九宫格图标间穿梭时，子元素/间隙会向根节点
        // 冒泡 dragleave，若照单全收会与 dragover 逐帧震荡（遮罩与图标闪烁）。
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragActive(false);
        probeKeyRef.current = "";
        setDragProbe(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        probeKeyRef.current = "";
        setDragProbe(null);
        handleFiles(event.dataTransfer?.files ?? null);
      }}
    >
      {/* The library header row (kb name + overflow menu incl. upload)
          lives in `MiddleTabs`; this pane starts at its own toolbar.
          Dragging files anywhere onto this pane also uploads. */}

      {/* Toolbar: batch actions while selecting, otherwise the name filter
          and the sort dropdown (client-side view controls; upload lives in
          the library menu so this row stays lean).
          2026-09-01: 一个稳定容器（固定 44px 整数高），内容切换不换节点——
          避免工具栏/批量栏两个独立 DOM 切换时的子像素重排（首行 0.3px 上跳）。 */}
      <div className="flex h-11 items-center gap-2 px-4">
        {selectedIds.size > 0 ? (
          <div
            className="flex w-full items-center gap-2"
            data-testid="document-batch-bar"
          >
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
          <Button
            className="h-7"
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="size-3.5" />
            {tk.cancelSelection}
          </Button>
          </div>
        ) : (
          <div className="flex w-full items-center gap-2">
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
              <Button
                aria-label={tk.sortDocuments}
                className="size-7"
                size="icon-sm"
                variant="ghost"
              >
                <ArrowUpDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>{tk.sortDocuments}</DropdownMenuLabel>
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  onSelect={() =>
                    setSort((current) => ({ ...current, key: option.key }))
                  }
                >
                  <Check
                    className={cn(
                      "size-4",
                      sort.key !== option.key && "invisible",
                    )}
                  />
                  {tk.sort[option.labelKey]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {(["asc", "desc"] as const).map((direction) => (
                <DropdownMenuItem
                  key={direction}
                  onSelect={() =>
                    setSort((current) => ({ ...current, direction }))
                  }
                >
                  <Check
                    className={cn(
                      "size-4",
                      sort.direction !== direction && "invisible",
                    )}
                  />
                  {tk.sort[direction]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}
      </div>

      {/* Document table (horizontal scroll protects the columns on narrow
          widths; 2026-08-31 操作列瘦身为尾部窄列，只承接悬停淡入的三个点) */}
      {/* 内容区：遮罩的定位上下文只盖表格区，不包住工具栏；外层不滚动，
          遮罩不随表格滚动。内层才是滚动容器。 */}
      <div className="relative min-h-0 flex-1">
        {/* Drop feedback overlay: makes the drop affordance explicit while a
            file hovers over the panel (the root bg tint alone is too subtle).
            Empty kb: border-only overlay so the nine-grid probe stays visible,
            hint pinned to the bottom; all-rejected drags swap the copy. */}
        {dragActive &&
          (documents.length === 0 ? (
            <div
              className="pointer-events-none absolute inset-2 z-10 rounded-lg border-2 border-dashed"
              data-testid="document-drop-overlay"
            >
              <p className="text-muted-foreground absolute inset-x-0 bottom-3 flex justify-center">
                <span className="bg-background flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm">
                  <Upload className="size-3.5" />
                  {dragProbe && dragProbe.anyRejected && !dragProbe.anyAccepted
                    ? tk.dropUnsupported
                    : tk.dropToUpload}
                </span>
              </p>
            </div>
          ) : (
            <div
              className="bg-background/70 pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed"
              data-testid="document-drop-overlay"
            >
              <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Upload className="size-4" />
                {tk.dropToUpload}
              </p>
            </div>
          ))}
        <div className="h-full overflow-auto">
        {documents.length === 0 ? (
          <EmptyDocumentsState probe={dragProbe} />
        ) : visibleDocuments.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            {tk.noMatchingDocuments}
          </p>
        ) : (
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b h-9 text-left text-xs whitespace-nowrap">
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
                {/* 数值列表头左对齐（与文本列一致，2026-08-31 用户拍板），
                    数值内容整体靠右 + tabular-nums，单位右缘自成列 */}
                <th className="px-2 py-2 font-medium">{tk.table.size}</th>
                <th className="px-2 py-2 font-medium">{tk.table.chunks}</th>
                {/* 尾部窄列只承接悬停三个点（2026-08-31）：平时留白不遮数值，
                    Drive/SharePoint 惯例；表头无内容 */}
                <th className="w-10" />
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
                          // 行分隔靠留白+悬停底色（2026-08-31）：去 border-b，
                          // 对齐 Drive/Notion 无框表风格，结构线只留表头与统计行两条。
                          "group hover:bg-muted/50 cursor-pointer",
                          isSelected && "bg-muted/60",
                        )}
                        data-selected={isSelected}
                        onClick={() => onOpenChunks(doc)}
                        onContextMenu={() => handleRowContextMenu(doc.id)}
                      >
                        <td
                          className="w-8 px-2 py-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={`${tk.selectDocument}: ${doc.name}`}
                            checked={isSelected}
                            className={cn(
                              "opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100",
                              selectedIds.size > 0 && "opacity-100",
                            )}
                            onCheckedChange={(checked) =>
                              toggleSelect(doc.id, checked === true)
                            }
                          />
                        </td>
                        <td className="max-w-48 px-2 py-2">
                          <div className="flex items-center gap-2">
                            {/* 类型徽章：设计稿 56 网格原样，20px 是保得住折角与细节条的 S 档下限（16px 会糊成 1px 发丝） */}
                            <FileTypeBadge
                              className="size-5 shrink-0"
                              fileName={doc.name}
                            />
                            <span className="truncate">{doc.name}</span>
                          </div>
                        </td>
                        {/* 上传者内容内缩一档（2026-08-31）：表头 12px 浅灰、内容 14px 深色，
                            重墨色视觉上会「抢出来」，pl-3 比表头 px-2 多缩 4px 做光学校正 */}
                        <td className="text-muted-foreground py-2 pr-2 pl-3">
                          {doc.uploader_id === kb.owner_id
                            ? tk.uploaderMe
                            : doc.uploader_id}
                        </td>
                        {/* 状态单元格单行（2026-08-31）：错误行已删，不再需要 flex-col 叠放，
                      nowrap 防换行（图 1 反馈失败行被撑高）；失败态重试收进悬停卡片 */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          {(() => {
                            const statusIndicator = (
                              <span
                                className="relative flex w-fit items-center gap-1"
                                data-testid={
                                  doc.path_status
                                    ? "path-status-trigger"
                                    : undefined
                                }
                              >
                                {/* 悬挂标记：-left-2.5 = 点 6px + 间隙 4px，与 td 的
                                    px-2 配对，文字左缘才压得住表头那条线 */}
                                <span
                                  aria-hidden
                                  className={cn(
                                    "absolute top-1/2 -left-2.5 size-1.5 -translate-y-1/2 rounded-full",
                                    STATUS_DOT_CLASS[doc.status] ??
                                      "bg-muted-foreground/60",
                                  )}
                                />
                                <span
                                  className={cn(
                                    "text-xs",
                                    doc.status === "failed"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {statusText(doc.status)}
                                </span>
                                {/* 百分比只在 indexing 显示——前置阶段（解析/切片）无可测进度，不挂无信息量的 0% */}
                                {doc.status === "indexing" && (
                                  <span className="text-muted-foreground text-xs">
                                    {doc.progress_percent}%
                                  </span>
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
                                    <span
                                      className="cursor-default"
                                      data-testid="doc-retry-trigger"
                                    >
                                      {statusIndicator}
                                    </span>
                                  </HoverCardTrigger>
                                  <HoverCardContent
                                    align="start"
                                    className="w-60 p-3"
                                    data-testid="doc-retry-card"
                                    side="top"
                                  >
                                    <p className="text-muted-foreground mb-2 text-xs">
                                      {
                                        tk.docErrors[
                                          classifyDocError(doc.error)
                                        ]
                                      }
                                    </p>
                                    <Button
                                      className="h-7 gap-1.5 px-2.5"
                                      size="sm"
                                      onClick={() => onRetryDocument(doc.id)}
                                    >
                                      <RotateCcw className="size-3.5" />
                                      {tk.retryDocument}
                                    </Button>
                                  </HoverCardContent>
                                </HoverCard>
                              );
                            }
                            // P3：path_status 非 null 才挂悬停（老行/未进索引不展示）
                            return doc.path_status ? (
                              <Tooltip
                                content={<PathStatusBreakdown doc={doc} />}
                              >
                                {statusIndicator}
                              </Tooltip>
                            ) : (
                              statusIndicator
                            );
                          })()}
                        </td>
                        {/* 时间列等宽数字（2026-08-31）：格式已零填充定长，再加 tabular-nums
                      使 1/2 同宽，行间时分纵向对齐（与大小/切片数同方案） */}
                        <td className="text-muted-foreground px-2 py-2 whitespace-nowrap tabular-nums">
                          {formatKnowledgeTimestamp(doc.created_at, locale)}
                        </td>
                        {/* 大小统一 KB（2026-08-31）：每格带 KB 后缀（表头不带单位），
                      纯数字千分位 + 右对齐；精确字节收进悬停 Tooltip，不占列宽 */}
                        <td className="text-muted-foreground px-2 py-2 text-right whitespace-nowrap tabular-nums">
                          <Tooltip
                            content={`${doc.size_bytes.toLocaleString()} B`}
                          >
                            <span data-testid="doc-size-value">
                              {formatKb(doc.size_bytes)} KB
                            </span>
                          </Tooltip>
                        </td>
                        <td className="text-muted-foreground px-2 py-2 text-right tabular-nums">
                          {doc.chunk_count ?? "—"}
                        </td>
                        {/* 悬停三个点窄列（2026-08-31）：预留列不遮切片数/大小——
                      悬停/选中/键盘聚焦时淡入；菜单镜像右键菜单（查看切片/重试/删除），
                      右键菜单保留兜底 */}
                        <td
                          className="w-10 px-1 py-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div
                            className={cn(
                              "flex justify-end transition-opacity",
                              "opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100",
                              isSelected && "opacity-100",
                            )}
                            data-testid="doc-row-more"
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label={tk.moreActions}
                                  className="size-6"
                                  size="icon"
                                  variant="ghost"
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  onSelect={() => onOpenChunks(doc)}
                                >
                                  <FileText className="size-4" />
                                  {tk.openChunks}
                                </DropdownMenuItem>
                                {doc.status === "failed" && (
                                  <DropdownMenuItem
                                    onSelect={() => onRetryDocument(doc.id)}
                                  >
                                    <RotateCcw className="size-4" />
                                    {tk.retryDocument}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setDeleteTargets([doc.id])}
                                >
                                  <Trash2 className="size-4" />
                                  {tk.deleteDocument}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44">
                      {isSelected && selectedIds.size > 1 ? (
                        <>
                          <ContextMenuLabel>
                            {tk.selectedCount(selectedIds.size)}
                          </ContextMenuLabel>
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() =>
                              runAfterMenuClose(() =>
                                setDeleteTargets([...selectedIds]),
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                            {tk.deleteSelected}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => setSelectedIds(new Set())}
                          >
                            {tk.cancelSelection}
                          </ContextMenuItem>
                        </>
                      ) : (
                        <>
                          <ContextMenuItem
                            onSelect={() =>
                              runAfterMenuClose(() => onOpenChunks(doc))
                            }
                          >
                            <FileText className="size-4" />
                            {tk.openChunks}
                          </ContextMenuItem>
                          {doc.status === "failed" && (
                            <ContextMenuItem
                              onSelect={() => onRetryDocument(doc.id)}
                            >
                              <RotateCcw className="size-4" />
                              {tk.retryDocument}
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() =>
                              runAfterMenuClose(() =>
                                setDeleteTargets([doc.id]),
                              )
                            }
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
      </div>

      {/* Bottom stats row (spec §3.6, aggregated client-side) */}
      <div
        className="text-muted-foreground border-t px-4 py-2 text-xs"
        data-testid="document-stats-row"
      >
        {tk.statsDocuments} {stats.total} · {tk.statsChunks} {stats.totalChunks}{" "}
        · {formatBytes(stats.totalBytes)} · {tk.statsReady} {stats.ready} ·{" "}
        {tk.statsIndexing} {stats.inProgress} · {tk.statsFailed} {stats.failed}
      </div>

      {/* Document delete confirm */}
      <Dialog
        open={deleteTargets !== null}
        onOpenChange={(open) => !open && setDeleteTargets(null)}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.deleteDocumentConfirmTitle}</DialogTitle>
            <DialogDescription>
              {tk.deleteDocumentConfirmDescription}
            </DialogDescription>
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
