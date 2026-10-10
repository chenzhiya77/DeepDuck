"use client";

import { useMemo } from "react";
import type { ImgHTMLAttributes } from "react";

import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { createMarkdownLinkComponent } from "@/components/workspace/messages/markdown-link";
import { MessageImage } from "@/components/workspace/messages/message-image";
import { rehypeCitationMarks } from "@/core/knowledge/rehype-citation-marks";
import type { KnowledgeCitation } from "@/core/knowledge/types";

import { createCitationSupRenderer } from "./citation-mark";

/**
 * Assistant message body for the knowledge chat panel (phase-2 batch-1, P2).
 * Plain MarkdownContent while streaming; once the stream settles the
 * rehype-citation-marks plugin rewrites ``[n]`` into superscript marks
 * backed by this message's own sources (deferred rendering — a half-typed
 * ``[`` mid-stream never flickers).
 *
 * This renderer REPLACES MessageListItem's default MarkdownContent, so it
 * must carry that path's img/a overrides itself: without them a markdown
 * image in an answer keeps its raw ``/mnt/...`` src, resolves against the
 * page origin, and degrades to the renderer's "Image not available"
 * placeholder (2026-10-11 fix).
 */
export function KbAssistantContent({
  content,
  isLoading,
  sources,
  messageId,
  threadId,
  artifactPaths,
}: {
  content: string;
  isLoading: boolean;
  sources: KnowledgeCitation[];
  messageId: string;
  threadId: string;
  artifactPaths: readonly string[];
}) {
  const supRenderer = useMemo(() => createCitationSupRenderer(sources, messageId), [sources, messageId]);
  const components = useMemo(
    () => ({
      sup: supRenderer,
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <MessageImage {...props} threadId={threadId} artifactPaths={artifactPaths} />
      ),
      a: createMarkdownLinkComponent(threadId),
    }),
    [supRenderer, threadId, artifactPaths],
  );
  return (
    <MarkdownContent
      components={components}
      content={content}
      isLoading={isLoading}
      rehypePlugins={isLoading ? [] : [rehypeCitationMarks]}
    />
  );
}
