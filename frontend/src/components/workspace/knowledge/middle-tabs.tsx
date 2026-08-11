"use client";

import { BookOpen, MoreHorizontal, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeBase } from "@/core/knowledge/types";

import { runAfterMenuClose } from "./run-after-menu-close";

export type KnowledgeMiddleTab = "documents" | "wiki" | "recall";

/**
 * Middle-column container (phase-2 batch-1, spec §3 三行结构):
 *   row 1 — library header: kb name + overflow menu (generate wiki / rename /
 *           delete — library-scoped, visible for every tab);
 *   row 2 — the 文档|百科|检索测试 tab strip;
 *   row 3 — tab panes, keep-alive via forceMount so switching never unmounts
 *           the document table (search/sort/selection state and the indexing
 *           refetch interval survive), the wiki list, or the recall-test
 *           panel's last result.
 * Upload lives in the library menu (adding a document is a library-level
 * action, like generate-wiki/rename); the documents pane keeps its toolbar
 * lean (search + sort) and still accepts drag-drop anywhere on the pane.
 */
export function MiddleTabs({
  kb,
  activeTab,
  onTabChange,
  onUpload,
  uploading = false,
  onGenerateWiki,
  onRenameKb,
  onDeleteKb,
  documents,
  wiki,
  recall,
}: {
  kb: KnowledgeBase;
  activeTab: KnowledgeMiddleTab;
  onTabChange: (tab: KnowledgeMiddleTab) => void;
  onUpload: (files: File[]) => void;
  uploading?: boolean;
  onGenerateWiki: () => void;
  onRenameKb: (name: string) => Promise<void> | void;
  onDeleteKb: () => Promise<void> | void;
  documents: ReactNode;
  wiki: ReactNode;
  recall: ReactNode;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(kb.name);
  const [deleteKbOpen, setDeleteKbOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="knowledge-middle-tabs">
      {/* Row 1: library header (name + library-level overflow menu) */}
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
            const files = event.target.files;
            if (files && files.length > 0) {
              onUpload(Array.from(files));
            }
            event.target.value = "";
          }}
        />
      </div>

      {/* Rows 2+3: tab strip + keep-alive panes */}
      <Tabs
        className="min-h-0 flex-1 gap-0"
        value={activeTab}
        onValueChange={(value) => onTabChange(value as KnowledgeMiddleTab)}
      >
        <TabsList className="mx-4 mt-2" variant="line">
          <TabsTrigger value="documents">{tk.tabs.documents}</TabsTrigger>
          <TabsTrigger value="wiki">{tk.tabs.wiki}</TabsTrigger>
          <TabsTrigger value="recall">{tk.tabs.recall}</TabsTrigger>
        </TabsList>
        <TabsContent
          className="min-h-0 data-[state=inactive]:hidden"
          forceMount
          value="documents"
        >
          <div className="flex h-full min-h-0 flex-col">{documents}</div>
        </TabsContent>
        <TabsContent
          className="min-h-0 data-[state=inactive]:hidden"
          forceMount
          value="wiki"
        >
          <div className="flex h-full min-h-0 flex-col">{wiki}</div>
        </TabsContent>
        <TabsContent
          className="min-h-0 data-[state=inactive]:hidden"
          forceMount
          value="recall"
        >
          <div className="flex h-full min-h-0 flex-col">{recall}</div>
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
