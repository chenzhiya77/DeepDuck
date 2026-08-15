"use client";

import { BookOpen, FileText, StickyNote } from "lucide-react";
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
  // Phase-3 P6 (spec §8): manual cards cited through wiki_search get their
  // own badge (「我的卡片」/StickyNote) alongside 百科/文档.
  const sourceType = citation.source_type ?? "chunk";
  const typeLabel = sourceType === "wiki" ? tc.sourceTypeWiki : sourceType === "manual" ? tc.sourceTypeManual : tc.sourceTypeChunk;
  return (
    <div className="flex flex-col gap-1.5" data-testid="citation-preview">
      <div className="flex items-center gap-1.5 text-xs">
        {sourceType === "wiki" ? (
          <BookOpen className="text-muted-foreground size-3.5" />
        ) : sourceType === "manual" ? (
          <StickyNote className="text-muted-foreground size-3.5" />
        ) : (
          <FileText className="text-muted-foreground size-3.5" />
        )}
        <span className="text-muted-foreground">{typeLabel}</span>
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
  /** The DISPLAY number (the source's sorted strip position) — rendered on the mark and used as the jump target. */
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
 * The rehype-citation-marks plugin emits ``<sup data-citation-index="n">``
 * where ``n`` is the number the model wrote (the backend citation_no — an
 * internal handle, NEVER shown). The mark renders the DISPLAY number: the
 * source's 1-based position in the deduped, citation_no-sorted strip, so the
 * visible number space is continuous (1..N) and matches the cards exactly
 * (Perplexity-style). Resolution: (1) the source whose merged citation_nos
 * contains ``n`` — hybrid/graph overlap assigns one chunk several numbers,
 * and the model may cite any of them; (2) positional fallback for legacy
 * sources without citation_nos. Anything else falls back to a plain sup so
 * stale/foreign marks never crash.
 */
export function createCitationSupRenderer(sources: KnowledgeCitation[], messageId: string) {
  return function CitationSupRenderer(props: ComponentProps<"sup">) {
    const raw = (props as Record<string, unknown>)["data-citation-index"];
    const cited = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(cited) || cited < 1) {
      return <sup {...props} />;
    }
    let position = sources.findIndex((source) => source.citation_nos?.includes(cited));
    if (position < 0 && sources.every((source) => !source.citation_nos)) {
      // Legacy payloads carry no citation numbers at all — positional mapping.
      position = cited - 1 < sources.length ? cited - 1 : -1;
    }
    const citation = position >= 0 ? sources[position] : undefined;
    if (!citation) {
      return <sup {...props} />;
    }
    return <CitationMark citation={citation} index={position + 1} messageId={messageId} />;
  };
}
