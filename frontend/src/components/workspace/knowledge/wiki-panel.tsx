"use client";

import { BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/core/i18n/hooks";
import { formatKnowledgeTimestamp } from "@/core/knowledge/format";
import type { WikiEntrySummary } from "@/core/knowledge/types";

/**
 * Read-only wiki entries list (phase-2 batch-1): title + summary + dirty
 * badge + updated time. Row click opens the right-side entry drawer; the
 * drawer owns the full-text fetch. Management actions (regenerate/edit) are
 * intentionally absent — 可视化管理 is a later item.
 */
export function WikiPanel({
  entries,
  loading = false,
  onOpenEntry,
}: {
  entries: WikiEntrySummary[];
  loading?: boolean;
  onOpenEntry: (entry: WikiEntrySummary) => void;
}) {
  const { t, locale } = useI18n();
  const tw = t.knowledge.wikiPanel;

  if (loading && entries.length === 0) {
    return <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.loading}</p>;
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground px-4 py-10 text-center text-sm">{tw.empty}</p>;
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="wiki-entry-list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            className="hover:bg-muted/50 flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left"
            type="button"
            onClick={() => onOpenEntry(entry)}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium">{entry.title}</span>
              {entry.status === "dirty" && (
                <Badge className="shrink-0" variant="secondary">
                  {tw.dirty}
                </Badge>
              )}
            </span>
            <span className="text-muted-foreground line-clamp-2 pl-6 text-xs">{entry.summary}</span>
            <span className="text-muted-foreground pl-6 text-xs">
              {tw.updatedAt} {formatKnowledgeTimestamp(entry.updated_at, locale)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
