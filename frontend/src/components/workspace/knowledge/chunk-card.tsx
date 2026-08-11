"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/core/i18n/hooks";

/**
 * Shared read-only chunk card (spec §3.6 切片可视化 / §4.6 引用展开): the
 * chunk drawer renders the full-metadata form; the citation card expands to
 * the same component with just doc name + text.
 */
export function ChunkCard({
  text,
  headingPath,
  page,
  tokenCount,
  entities,
  docName,
}: {
  text: string;
  headingPath?: string[];
  page?: number | null;
  tokenCount?: number;
  entities?: string[];
  docName?: string;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chunkDrawer;
  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3 text-sm">
      {(docName ?? (headingPath && headingPath.length > 0)) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {docName && <span className="font-medium">{docName}</span>}
          {headingPath && headingPath.length > 0 && <span>{headingPath.join(" / ")}</span>}
        </div>
      )}
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
        {entities && entities.length > 0 && (
          // flex-wrap: many long entity badges must flow onto multiple lines
          // inside the card; shrink-0 keeps the label from being squeezed.
          <span className="flex flex-wrap items-center gap-1">
            <span className="shrink-0">{tc.entities}:</span>
            {entities.map((entity) => (
              <Badge key={entity} className="text-[10px]" variant="secondary">
                {entity}
              </Badge>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
