"use client";

import { BookOpen, Loader2, MoreHorizontal, Plus, RefreshCw, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import type { WikiGenerateMode } from "@/core/knowledge/api";
import type { WikiEntrySummary } from "@/core/knowledge/types";

import { ManualCardPanel } from "./manual-card-panel";
import { runAfterMenuClose } from "./run-after-menu-close";
import { WikiPanel } from "./wiki-panel";
import { WikiRebuildDialog } from "./wiki-rebuild-dialog";

/**
 * Wiki tab content (split-section layout): one unified search box above two
 * independently collapsible sections — the AI entries (WikiPanel, default
 * expanded) and the user's manual cards (ManualCardPanel, default
 * collapsed). Each expanded section scrolls on its own; collapsing one
 * yields the whole column to the other, so a growing card list can never
 * squeeze the AI entries section. The query is owned here and passed down,
 * so one box filters both sections and typing clears both selections.
 */
export function WikiTab({
  kbId,
  entries,
  entriesLoading = false,
  updating = false,
  onGenerateWiki,
  onRegenerateEntries,
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onOpenCard,
}: {
  kbId: string;
  entries: WikiEntrySummary[];
  entriesLoading?: boolean;
  updating?: boolean;
  /**
   * 百科维护动作（2026-08-30）：更新/重建本是百科功能，此前只在全局库菜单；
   * tab 内 ⋯ 承接同一触发器，与全局双入口。
   */
  onGenerateWiki?: (mode: WikiGenerateMode) => void;
  /** 局部更新/重建（2026-09-02）：透传给 WikiPanel 右键菜单（单条/多选）。 */
  onRegenerateEntries?: (entryIds: string[]) => void;
  onOpenEntry: (entry: WikiEntrySummary) => void;
  onEditEntry?: (entry: WikiEntrySummary) => void;
  onDeleteEntry: (entry: WikiEntrySummary) => Promise<void> | void;
  onOpenCard?: (cardId: string) => void;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const [query, setQuery] = useState("");
  const [rebuildOpen, setRebuildOpen] = useState(false);
  // 新建卡片全局入口（2026-09-02）：⋯ 菜单递增此信号，ManualCardPanel 用
  // render-time 派生状态监听变化并弹出创建框（同 lastQuery 惯用法）。
  const [cardCreateSignal, setCardCreateSignal] = useState(0);

  return (
    <div className="flex h-full flex-col" data-testid="wiki-tab">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            aria-label={tk.searchWiki}
            className="h-7 pr-7 pl-7 text-xs"
            placeholder={tk.searchWiki}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              aria-label={tk.clearSearch}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
              type="button"
              onClick={() => setQuery("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {/* 百科操作 ⋯（2026-08-30）：搜索框后承接更新/重建，与全局库菜单双入口；
            触发器 size-7 保 44px 栏高（⋯ 降档陷阱：默认 sm 是 h-8）；
            更新中禁用规则与全局菜单一致。 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={tk.wikiMoreOptions} className="size-7 shrink-0" size="icon-sm" variant="ghost">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {/* 新建卡片全局入口（2026-09-02）：创建是 add 动作，置于维护动作之前
                （对齐全局库菜单「上传文档」在首的次序）；与 wiki 生成无关，始终可用。 */}
            <DropdownMenuItem onSelect={() => runAfterMenuClose(() => setCardCreateSignal((n) => n + 1))}>
              <Plus className="size-4" />
              {tk.manualCards.newCard}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={updating} onSelect={() => onGenerateWiki?.("incremental")}>
              {updating ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />}
              {updating ? tk.wikiPanel.updating : tk.updateWiki}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={updating} onSelect={() => runAfterMenuClose(() => setRebuildOpen(true))}>
              <RefreshCw className="size-4" />
              {tk.rebuildWiki}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <WikiPanel
        entries={entries}
        loading={entriesLoading}
        query={query}
        updating={updating}
        onDeleteEntry={onDeleteEntry}
        onEditEntry={onEditEntry}
        onOpenEntry={onOpenEntry}
        onRegenerateEntries={onRegenerateEntries}
      />
      <ManualCardPanel kbId={kbId} query={query} createSignal={cardCreateSignal} onOpenCard={onOpenCard} />
      {/* 重建确认弹窗：与全局库菜单共用同一共享组件 */}
      <WikiRebuildDialog
        open={rebuildOpen}
        onOpenChange={setRebuildOpen}
        onConfirm={() => {
          onGenerateWiki?.("full");
          setRebuildOpen(false);
        }}
      />
    </div>
  );
}
