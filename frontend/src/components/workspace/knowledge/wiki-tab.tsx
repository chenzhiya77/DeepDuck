"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import type { WikiEntrySummary } from "@/core/knowledge/types";

import { ManualCardPanel } from "./manual-card-panel";
import { WikiPanel } from "./wiki-panel";

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
  onOpenEntry,
  onEditEntry,
  onDeleteEntry,
  onOpenCard,
}: {
  kbId: string;
  entries: WikiEntrySummary[];
  entriesLoading?: boolean;
  updating?: boolean;
  onOpenEntry: (entry: WikiEntrySummary) => void;
  onEditEntry?: (entry: WikiEntrySummary) => void;
  onDeleteEntry: (entry: WikiEntrySummary) => Promise<void> | void;
  onOpenCard?: (cardId: string) => void;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const [query, setQuery] = useState("");

  return (
    <div className="flex h-full flex-col" data-testid="wiki-tab">
      <div className="shrink-0 border-b px-4 py-2">
        <div className="relative">
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
      </div>
      <WikiPanel
        entries={entries}
        loading={entriesLoading}
        query={query}
        updating={updating}
        onDeleteEntry={onDeleteEntry}
        onEditEntry={onEditEntry}
        onOpenEntry={onOpenEntry}
      />
      <ManualCardPanel kbId={kbId} query={query} onOpenCard={onOpenCard} />
    </div>
  );
}
