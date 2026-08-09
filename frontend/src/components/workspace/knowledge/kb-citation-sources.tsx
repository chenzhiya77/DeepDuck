"use client";

import { BookOpenIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeCitation } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import { ChunkCard } from "./chunk-card";

/**
 * Citation cards under an assistant answer (spec §4.6/§3.6). The answer's
 * retrieval sources render as a numbered list; clicking a source expands the
 * shared ChunkCard with the original chunk text.
 */
export function KbCitationSources({ sources }: { sources: KnowledgeCitation[] }) {
  const { t } = useI18n();
  const tc = t.knowledge.chat;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (sources.length === 0) {
    return null;
  }
  const expanded = sources.find((source) => source.chunk_id === expandedId) ?? null;
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="kb-citation-sources">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <BookOpenIcon className="size-3.5" />
        <span>{tc.sources}</span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {sources.map((source, index) => {
          const isExpanded = source.chunk_id === expandedId;
          return (
            <li key={source.chunk_id}>
              <button
                type="button"
                aria-expanded={isExpanded}
                className={cn(
                  "hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  isExpanded && "bg-muted/60",
                )}
                onClick={() => setExpandedId(isExpanded ? null : source.chunk_id)}
              >
                <span className="text-muted-foreground shrink-0 font-mono">[{index + 1}]</span>
                <span className="min-w-0 flex-1 truncate font-medium">{source.doc_name}</span>
                {source.page != null && (
                  <span className="text-muted-foreground shrink-0">{tc.pageLabel(source.page)}</span>
                )}
              </button>
              {isExpanded && expanded && (
                <div className="mt-1 mb-1.5 ml-6">
                  <ChunkCard docName={expanded.doc_name} text={expanded.text} page={expanded.page} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
