"use client";

import { ChevronDown, ChevronRight, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
 * Manual knowledge card panel (Phase-3 Batch-1 P6, spec §8): a collapsible
 * section under the wiki tab — default collapsed, fetching lazily on first
 * expand. Cards are fully user-managed (never auto-regenerated, unlike the AI
 * wiki entries above); each row carries a 混入搜索 toggle driving the card's
 * retrieval vector lifecycle server-side.
 */
export function ManualCardPanel({ kbId, onOpenCard }: { kbId: string; onOpenCard?: (cardId: string) => void }) {
  const { t, locale } = useI18n();
  const tc = t.knowledge.manualCards;
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManualCardSummary | null>(null);

  // Lazy: the list only fetches once the section is first expanded.
  const cardsQuery = useManualCards(kbId, expanded);
  const cards = cardsQuery.data?.items ?? [];
  const total = cardsQuery.data?.total ?? 0;

  const editingCardQuery = useManualCard(kbId, editingId);
  const editingCard = editingId !== null ? (editingCardQuery.data ?? null) : null;

  const createCard = useCreateManualCard(kbId);
  const updateCard = useUpdateManualCard(kbId);
  const deleteCard = useDeleteManualCard(kbId);

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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCard.mutateAsync(deleteTarget.id);
      toast.success(tc.deleteSuccess);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tc.deleteFailed);
    }
    setDeleteTarget(null);
  };

  return (
    <div className="shrink-0 border-t" data-testid="manual-cards-section">
      <button
        aria-expanded={expanded}
        className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-4 py-2 text-left"
        data-testid="manual-cards-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="text-sm font-medium">{tc.sectionTitle}</span>
        {total > 0 && (
          <Badge className="ml-1" variant="secondary">
            {total}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2">
          <div className="flex justify-end px-2 py-1">
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="size-4" />
              {tc.newCard}
            </Button>
          </div>
          {cardsQuery.isLoading ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">{tc.loading}</p>
          ) : cards.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">{tc.empty}</p>
          ) : (
            <ul className="flex flex-col" data-testid="manual-card-list">
              {cards.map((card) => (
                <li className="group relative" key={card.id}>
                  {/* 行点击开详情抽屉（与 wiki 条目对齐）；右侧操作区是 li 的
                      sibling（不在行 button 内），编辑/删除/开关不会误触发行点击。 */}
                  <button
                    className="hover:bg-muted/50 flex w-full flex-col gap-1 rounded-md px-2 py-2 pr-28 text-left"
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
                  <div className="absolute top-1.5 right-2 flex items-center gap-1">
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
                      onClick={() => setDeleteTarget(card)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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

      {/* Delete confirm — the copy states irreversibility (卡片与向量一并删除). */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tc.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{tc.deleteConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t.common.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
