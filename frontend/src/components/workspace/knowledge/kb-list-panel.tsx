"use client";

import { LibraryBig, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeBase } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

/**
 * Left column of the knowledge page (spec §5.2): the 个人知识库 group, the
 * header「+」create dialog, and per-kb selection. Presentational — the page
 * owns data fetching and mutations.
 */
export function KbListPanel({
  kbs,
  selectedKbId,
  onSelect,
  onCreate,
}: {
  kbs: KnowledgeBase[];
  selectedKbId: string | null;
  onSelect: (kbId: string) => void;
  onCreate: (name: string, description: string) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetAndClose = () => {
    setCreateOpen(false);
    setName("");
    setDescription("");
    setSubmitting(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onCreate(name.trim(), description.trim());
      resetAndClose();
    } catch {
      // The page-level mutation surfaces the error toast; keep the dialog open.
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="kb-list-panel">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-muted-foreground text-xs font-medium">{tk.personalKBs}</span>
        <Button
          aria-label={tk.createKB}
          className="size-6"
          size="icon"
          variant="ghost"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {kbs.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">{tk.emptyKbList}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {kbs.map((kb) => {
              const isActive = kb.id === selectedKbId;
              return (
                <li key={kb.id}>
                  <button
                    className={cn(
                      "hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      isActive && "bg-muted font-medium",
                    )}
                    data-active={isActive}
                    type="button"
                    onClick={() => onSelect(kb.id)}
                  >
                    <LibraryBig className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 truncate">{kb.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{tk.createKB}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input
              autoFocus
              placeholder={tk.kbNamePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              placeholder={tk.kbDescriptionPlaceholder}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAndClose}>
              {t.common.cancel}
            </Button>
            <Button disabled={!name.trim() || submitting} onClick={() => void handleCreate()}>
              {t.common.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
