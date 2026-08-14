"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import type { WikiEntryDetail } from "@/core/knowledge/types";

/**
 * Wiki entry dual-mode editor (Phase-3 Batch-1 P1).
 * - Main content area: editable, replaced on next LLM re-generation
 * - Supplement layer: persistent user annotations that survive re-generation
 */
export interface WikiEditDialogProps {
  entry: WikiEntryDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entryId: string, content: string, supplementContent: string | null) => Promise<void>;
}

export function WikiEditDialog({ entry, open, onOpenChange, onSave }: WikiEditDialogProps) {
  const { t } = useI18n();
  const te = t.knowledge.wikiEdit;
  const [content, setContent] = useState(entry?.content ?? "");
  const [supplement, setSupplement] = useState(entry?.supplement_content ?? "");
  const [saving, setSaving] = useState(false);

  // Reset form when entry changes
  const entryId = entry?.id;
  const [prevEntryId, setPrevEntryId] = useState(entryId);
  if (entryId !== prevEntryId) {
    setPrevEntryId(entryId);
    setContent(entry?.content ?? "");
    setSupplement(entry?.supplement_content ?? "");
  }

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await onSave(entry.id, content.trim(), supplement.trim() || null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{te.title}</DialogTitle>
          <DialogDescription>{te.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Main content area */}
          <div className="space-y-2">
            <Label htmlFor="wiki-main-content">{te.mainContentLabel}</Label>
            <Textarea
              id="wiki-main-content"
              className="min-h-[200px] resize-y font-mono text-sm"
              placeholder={te.mainContentPlaceholder}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{te.mainContentHint}</p>
          </div>

          {/* Supplement layer */}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="wiki-supplement-content">{te.supplementLabel}</Label>
            <Textarea
              id="wiki-supplement-content"
              className="min-h-[100px] resize-y text-sm"
              placeholder={te.supplementPlaceholder}
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{te.supplementHint}</p>
          </div>

          {/* Audit metadata */}
          {entry?.updated_at && (
            <div className="text-muted-foreground space-y-1 border-t pt-4 text-xs">
              <p>{te.auditLastEdited}: {new Date(entry.updated_at).toLocaleString()}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={!content.trim() || saving} onClick={handleSave}>
            {saving ? te.saving : te.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
