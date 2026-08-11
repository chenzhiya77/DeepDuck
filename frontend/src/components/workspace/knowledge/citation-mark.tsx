"use client";

import { BookOpen, FileText } from "lucide-react";
import type { ComponentProps } from "react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeCitation } from "@/core/knowledge/types";

/**
 * Superscript citation mark (phase-2 batch-1, spec §4): the answer's ``[n]``
 * renders as a small muted superscript button — visually annotation-layer,
 * not body text. Hover shows a preview card (type badge + doc name + page /
 * heading path + ~120-char excerpt, reusing the citation's own ``text`` — no
 * new API); clicking dispatches ``KB_CITATION_JUMP_EVENT`` so the sources
 * strip expands and highlights the matching card. On touch devices (no
 * hover) the tap still jumps — the strip auto-opens the chunk card.
 */

export const KB_CITATION_JUMP_EVENT = "kb-citation-jump";

export type CitationJumpDetail = { messageId: string; index: number };

export function CitationPreviewCard({ citation }: { citation: KnowledgeCitation }) {
  const { t } = useI18n();
  const tc = t.knowledge.chat;
  const isWiki = citation.source_type === "wiki";
  return (
    <div className="flex flex-col gap-1.5" data-testid="citation-preview">
      <div className="flex items-center gap-1.5 text-xs">
        {isWiki ? <BookOpen className="text-muted-foreground size-3.5" /> : <FileText className="text-muted-foreground size-3.5" />}
        <span className="text-muted-foreground">{isWiki ? tc.sourceTypeWiki : tc.sourceTypeChunk}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{citation.doc_name}</span>
        {citation.page != null && <span className="text-muted-foreground shrink-0">{tc.pageLabel(citation.page)}</span>}
      </div>
      {citation.heading_path.length > 0 && (
        <div className="text-muted-foreground truncate text-xs">{citation.heading_path.join(" / ")}</div>
      )}
      <p className="text-muted-foreground line-clamp-3 text-xs">{citation.text.slice(0, 120)}</p>
    </div>
  );
}

export function CitationMark({
  citation,
  index,
  messageId,
}: {
  citation: KnowledgeCitation;
  index: number;
  messageId: string;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chat;
  return (
    <HoverCard closeDelay={100} openDelay={300}>
      <HoverCardTrigger asChild>
        <button
          aria-label={tc.sourceMarkAriaLabel(index, citation.doc_name)}
          className="text-muted-foreground bg-muted/60 hover:bg-muted mx-0.5 inline-flex h-[1.4em] min-w-[1.4em] items-center justify-center rounded px-0.5 align-super text-[0.7em] leading-none font-medium"
          data-citation-mark={index}
          type="button"
          onClick={() => {
            const detail: CitationJumpDetail = { messageId, index };
            window.dispatchEvent(new CustomEvent(KB_CITATION_JUMP_EVENT, { detail }));
          }}
        >
          {index}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <CitationPreviewCard citation={citation} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Build the markdown ``sup`` component override for one assistant message.
 * The rehype-citation-marks plugin emits ``<sup data-citation-index="n">``;
 * valid indexes (1-based into ``sources``) become CitationMark, anything
 * else falls back to a plain sup so stale/foreign marks never crash.
 */
export function createCitationSupRenderer(sources: KnowledgeCitation[], messageId: string) {
  return function CitationSupRenderer(props: ComponentProps<"sup">) {
    const raw = (props as Record<string, unknown>)["data-citation-index"];
    const index = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    const citation = Number.isInteger(index) && index >= 1 ? sources[index - 1] : undefined;
    if (!citation) {
      return <sup {...props} />;
    }
    return <CitationMark citation={citation} index={index} messageId={messageId} />;
  };
}
