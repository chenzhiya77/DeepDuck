"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";

/**
 * Shared chunk card (spec §3.6 切片可视化 / §4.6 引用展开): the chunk drawer
 * renders the full-metadata form; the citation card expands to the same
 * component with just doc name + text. Phase-3 Batch-1 adds edit/delete actions.
 */
export function ChunkCard({
  chunkId,
  text,
  headingPath,
  page,
  tokenCount,
  entities,
  docName,
  lastEditedAt,
  onEdit,
  onDelete,
}: {
  chunkId?: string;
  text: string;
  headingPath?: string[];
  page?: number | null;
  tokenCount?: number;
  entities?: string[];
  docName?: string;
  lastEditedAt?: string | null;
  onEdit?: (chunkId: string, newText: string) => Promise<void>;
  onDelete?: (chunkId: string) => void;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chunkDrawer;
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(text);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!chunkId || !onEdit) return;
    setIsSaving(true);
    try {
      await onEdit(chunkId, editedText);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedText(text);
    setIsEditing(false);
  };

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3 text-sm">
      {(docName ?? (headingPath && headingPath.length > 0)) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {docName && <span className="font-medium">{docName}</span>}
          {headingPath && headingPath.length > 0 && <span>{headingPath.join(" / ")}</span>}
        </div>
      )}

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            className="min-h-[100px] font-mono text-sm"
            onChange={(e) => setEditedText(e.target.value)}
            value={editedText}
          />
          <p className="text-muted-foreground text-xs">{tc.editHint}</p>
          <div className="flex gap-2">
            <Button disabled={isSaving || !editedText.trim()} onClick={handleSave} size="sm">
              {tc.save}
            </Button>
            <Button disabled={isSaving} onClick={handleCancel} size="sm" variant="outline">
              {tc.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm break-words whitespace-pre-wrap">{text}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {page != null && (
              <span>
                {tc.page} {page}
              </span>
            )}
            {tokenCount != null && (
              <span>
                {tokenCount} {tc.tokens}
              </span>
            )}
            {lastEditedAt && (
              <Badge className="text-[10px]" variant="outline">
                {tc.edited}
              </Badge>
            )}
            {entities && entities.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                <span className="shrink-0">{tc.entities}:</span>
                {entities.map((entity) => (
                  <Badge className="text-[10px]" key={entity} variant="secondary">
                    {entity}
                  </Badge>
                ))}
              </span>
            )}
          </div>
          {(onEdit ?? onDelete) && chunkId && (
            <div className="flex gap-1 pt-1">
              {onEdit && (
                <Button onClick={() => setIsEditing(true)} size="sm" variant="ghost">
                  <Pencil className="mr-1 h-3 w-3" />
                  {tc.edit}
                </Button>
              )}
              {onDelete && (
                <Button onClick={() => onDelete(chunkId)} size="sm" variant="ghost">
                  <Trash2 className="mr-1 h-3 w-3" />
                  {tc.delete}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
