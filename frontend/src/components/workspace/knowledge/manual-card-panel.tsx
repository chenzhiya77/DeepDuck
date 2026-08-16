"use client";

import { ChevronDown, ChevronRight, Pencil, Plus, SearchCheck, SearchX, StickyNote, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { formatKnowledgeTimestamp } from "@/core/knowledge/format";
import {
  useCreateManualCard,
  useDeleteManualCard,
  useManualCard,
  useManualCards,
  useUpdateManualCard,
} from "@/core/knowledge/hooks";
import type { ManualCardDetail, ManualCardSummary } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { runAfterMenuClose } from "./run-after-menu-close";

interface CardPayload {
  title: string;
  content: string;
  tags: string[];
  include_in_wiki_search: boolean;
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Card create/edit dialog (Phase-3 Batch-1 P6). ``initial`` null = create
 * mode. Save is disabled until title + content are non-blank; a failed save
 * keeps the dialog open (the caller toasts and rethrows).
 */
function ManualCardEditor({
  initial,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  initial: ManualCardDetail | null;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (body: CardPayload) => Promise<void>;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.manualCards;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(", "));
  const [include, setInclude] = useState(initial?.include_in_wiki_search ?? false);
  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
        tags: parseTags(tagsInput),
        include_in_wiki_search: include,
      });
    } catch {
      // Stay open — the caller already surfaced the error toast.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{initial ? tc.editorEditTitle : tc.editorCreateTitle}</DialogTitle>
          <DialogDescription>{tc.editorDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-card-title">{tc.titleLabel}</Label>
            <Input id="manual-card-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tc.titlePlaceholder} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-card-content">{tc.contentLabel}</Label>
            <Textarea
              id="manual-card-content"
              className="min-h-32"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={tc.contentPlaceholder}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-card-tags">{tc.tagsLabel}</Label>
            <Input id="manual-card-tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder={tc.tagsPlaceholder} />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="manual-card-include" checked={include} onCheckedChange={setInclude} />
            <Label htmlFor="manual-card-include">{tc.includeInSearch}</Label>
            <span className="text-muted-foreground text-xs">{tc.includeHint}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={!canSave} onClick={() => void handleSubmit()}>
            {saving ? tc.saving : tc.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Manual knowledge card section of the wiki tab (Phase-3 Batch-1 P6, spec §8;
 * split-section redesign): a collapsible section under the AI entries —
 * default collapsed — sharing the tab's unified search box. Searching
 * force-fetches and force-expands the section (a collapsed section would
 * otherwise never match). The header carries the 新建卡片 button so card
 * creation stays reachable while collapsed. Rows carry the document-table
 * interaction model: checkbox multi-select + batch bar + batch delete, and a
 * right-click context menu (open / edit / include-toggle / delete). Cards are
 * fully user-managed (never auto-regenerated, unlike the AI wiki entries);
 * each row keeps its 混入搜索 toggle driving the card's retrieval vector
 * lifecycle server-side.
 */
export function ManualCardPanel({
  kbId,
  query = "",
  onOpenCard,
}: {
  kbId: string;
  /** Unified wiki-tab search text (title/summary/tags containment, client-side). */
  query?: string;
  onOpenCard?: (cardId: string) => void;
}) {
  const { t, locale } = useI18n();
  const tk = t.knowledge;
  const tc = t.knowledge.manualCards;
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<ManualCardSummary[] | null>(null);

  // Filtering clears the selection (same rule as the document table);
  // render-time derived-state reset avoids an effect round-trip.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setSelectedIds(new Set());
  }

  const searching = query.trim() !== "";
  // 搜索期间强制展开并放开 lazy fetch——收起的区永远搜不到。
  const effectiveExpanded = expanded || searching;

  // Lazy: the list fetches once the section is expanded (or a search is on).
  const cardsQuery = useManualCards(kbId, effectiveExpanded);
  const cards = useMemo(() => cardsQuery.data?.items ?? [], [cardsQuery.data]);
  const total = cardsQuery.data?.total ?? 0;

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return cards;
    }
    return cards.filter(
      (card) =>
        card.title.toLowerCase().includes(needle) ||
        card.summary.toLowerCase().includes(needle) ||
        card.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [cards, query]);

  const editingCardQuery = useManualCard(kbId, editingId);
  const editingCard = editingId !== null ? (editingCardQuery.data ?? null) : null;

  const createCard = useCreateManualCard(kbId);
  const updateCard = useUpdateManualCard(kbId);
  const deleteCard = useDeleteManualCard(kbId);

  // Selection (checkbox model, same as the document table).
  const visibleIds = visibleCards.map((card) => card.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const headerChecked = allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false;
  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };
  const toggleSelect = (cardId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(cardId);
      } else {
        next.delete(cardId);
      }
      return next;
    });
  };
  const handleRowContextMenu = (cardId: string) => {
    if (!selectedIds.has(cardId)) {
      setSelectedIds(new Set([cardId]));
    }
  };
  const selectedCards = () => cards.filter((card) => selectedIds.has(card.id));

  const openCreate = () => {
    setEditingId(null);
    setEditorOpen(true);
  };
  const openEdit = (card: ManualCardSummary) => {
    setEditingId(card.id);
    setEditorOpen(true);
  };

  const handleSave = async (body: CardPayload) => {
    try {
      if (editingId !== null) {
        await updateCard.mutateAsync({ cardId: editingId, body });
        toast.success(tc.updateSuccess);
      } else {
        await createCard.mutateAsync(body);
        toast.success(tc.createSuccess);
      }
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tc.saveFailed);
      throw error; // Keep the dialog open on failure.
    }
    setEditorOpen(false);
    setEditingId(null);
  };

  const handleToggle = async (card: ManualCardSummary, next: boolean) => {
    try {
      await updateCard.mutateAsync({ cardId: card.id, body: { include_in_wiki_search: next } });
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tc.saveFailed);
    }
  };

  const confirmDeleteTargets = async () => {
    if (!deleteTargets) {
      return;
    }
    const removed = new Set(deleteTargets.map((card) => card.id));
    const results = await Promise.allSettled(deleteTargets.map((card) => deleteCard.mutateAsync(card.id)));
    if (results.some((result) => result.status === "rejected")) {
      toast.error(tc.deleteFailed);
    } else {
      toast.success(tc.deleteSuccess);
    }
    setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
    setDeleteTargets(null);
  };

  return (
    <section
      className={cn("border-t", effectiveExpanded ? "flex min-h-0 flex-1 flex-col" : "flex shrink-0 flex-col")}
      data-testid="manual-cards-section"
    >
      {/* Section header: collapse toggle + count + select-all + 新建卡片
          (creation stays reachable while collapsed). */}
      <div className="flex shrink-0 items-center gap-1 pr-2">
        <button
          aria-expanded={effectiveExpanded}
          className="hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-4 py-2 text-left"
          data-testid="manual-cards-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {effectiveExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="text-sm font-medium">{tc.sectionTitle}</span>
          {total > 0 && (
            <Badge className="ml-1" variant="secondary">
              {total}
            </Badge>
          )}
        </button>
        {effectiveExpanded && visibleCards.length > 0 && (
          <Checkbox
            aria-label={tk.selectAllDocuments}
            checked={headerChecked}
            onCheckedChange={toggleSelectAll}
          />
        )}
        <Button className="h-7" size="sm" variant="outline" onClick={openCreate}>
          <Plus className="size-4" />
          {tc.newCard}
        </Button>
      </div>

      {effectiveExpanded && (
        <>
          {selectedIds.size > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5" data-testid="manual-cards-batch-bar">
              <span className="min-w-0 flex-1 text-xs font-medium">
                {tk.selectedCount(selectedIds.size)}
              </span>
              <Button
                className="h-7"
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTargets(selectedCards())}
              >
                <Trash2 className="size-3.5" />
                {tk.deleteSelected}
              </Button>
              <Button className="h-7" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                {tk.cancelSelection}
              </Button>
            </div>
          )}

          {cardsQuery.isLoading ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">{tc.loading}</p>
          ) : cards.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">{tc.empty}</p>
          ) : visibleCards.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">{tc.noMatches}</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" data-testid="manual-card-list">
              {visibleCards.map((card) => {
                const isSelected = selectedIds.has(card.id);
                return (
                  <li key={card.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className={cn(
                            "group hover:bg-muted/50 relative flex items-start rounded-md",
                            isSelected && "bg-muted/60",
                          )}
                          data-selected={isSelected}
                          onContextMenu={() => handleRowContextMenu(card.id)}
                        >
                          <Checkbox
                            aria-label={`${tc.selectCard}: ${card.title}`}
                            checked={isSelected}
                            className={cn(
                              "mt-3 ml-2 opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100",
                              selectedIds.size > 0 && "opacity-100",
                            )}
                            onCheckedChange={(checked) => toggleSelect(card.id, checked === true)}
                          />
                          {/* 行点击开详情抽屉（与 wiki 条目对齐）；右侧操作区是 row 内
                              sibling（不在行 button 内），编辑/删除/开关不会误触发行点击。 */}
                          <button
                            className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-2 pr-28 text-left"
                            data-testid={`manual-card-row-${card.id}`}
                            type="button"
                            onClick={() => onOpenCard?.(card.id)}
                          >
                            <span className="flex items-center gap-2">
                              <StickyNote className="text-muted-foreground size-4 shrink-0" />
                              <span className="min-w-0 truncate text-sm font-medium">{card.title}</span>
                              {card.include_in_wiki_search && (
                                <Badge className="shrink-0" variant="secondary">
                                  {tc.includeInSearch}
                                </Badge>
                              )}
                            </span>
                            <span className="text-muted-foreground line-clamp-2 pl-6 text-xs">{card.summary}</span>
                            {card.tags.length > 0 && (
                              <span className="flex flex-wrap gap-1 pl-6">
                                {card.tags.map((tag) => (
                                  <Badge key={tag} variant="outline">
                                    {tag}
                                  </Badge>
                                ))}
                              </span>
                            )}
                            <span className="text-muted-foreground pl-6 text-xs">
                              {tc.updatedAt} {formatKnowledgeTimestamp(card.updated_at, locale)}
                            </span>
                          </button>
                          {/* top-1 与 wiki 条目行操作区对齐（按钮中心 ≈ 标题行中心）。
                              pr-28 保留：Switch 常驻显示，右侧空间不可撤。 */}
                          <div className="absolute top-1 right-2 flex items-center gap-1">
                            <Switch
                              aria-label={`${tc.includeInSearch}: ${card.title}`}
                              checked={card.include_in_wiki_search}
                              onCheckedChange={(next) => void handleToggle(card, next)}
                            />
                            <Button
                              aria-label={tc.editCard}
                              className="text-muted-foreground hover:text-primary"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => openEdit(card)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              aria-label={tc.deleteCard}
                              className="text-muted-foreground hover:text-destructive"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setDeleteTargets([card])}
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
                              onSelect={() => runAfterMenuClose(() => setDeleteTargets(selectedCards()))}
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
                            <ContextMenuItem onSelect={() => runAfterMenuClose(() => onOpenCard?.(card.id))}>
                              <StickyNote className="size-4" />
                              {tc.openCard}
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => runAfterMenuClose(() => openEdit(card))}>
                              <Pencil className="size-4" />
                              {tc.editCard}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => void handleToggle(card, !card.include_in_wiki_search)}
                            >
                              {card.include_in_wiki_search ? (
                                <SearchX className="size-4" />
                              ) : (
                                <SearchCheck className="size-4" />
                              )}
                              {card.include_in_wiki_search ? tc.includeOff : tc.includeOn}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() => runAfterMenuClose(() => setDeleteTargets([card]))}
                            >
                              <Trash2 className="size-4" />
                              {tc.deleteCard}
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

      {/* Create opens immediately; edit waits for the detail fetch. */}
      {editorOpen && (editingId === null || editingCard !== null) && (
        <ManualCardEditor
          key={editingId ?? "create"}
          initial={editingCard}
          open={editorOpen}
          saving={createCard.isPending || updateCard.isPending}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) {
              setEditingId(null);
            }
          }}
          onSave={handleSave}
        />
      )}

      {/* Delete confirm — the copy states irreversibility (卡片与向量一并删除);
          the title carries the count in the batch case. */}
      <Dialog open={deleteTargets !== null} onOpenChange={(open) => !open && setDeleteTargets(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {deleteTargets && deleteTargets.length > 1
                ? tc.deleteBatchTitle(deleteTargets.length)
                : tc.deleteConfirmTitle}
            </DialogTitle>
            <DialogDescription>{tc.deleteConfirmDescription}</DialogDescription>
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
