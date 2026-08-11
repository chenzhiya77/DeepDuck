/**
 * Citation extraction from retrieval tool messages (spec §4.6).
 *
 * The rag agent's tools return JSON payloads: hybrid_search ``results`` and
 * graph_search ``evidence`` are chunk-level sources; wiki_search ``entries``
 * are entry-level (title as the source name, full content as the text). An
 * assistant answer's ``[n]`` markers map onto the merged, deduped source list
 * of its own turn — everything between the previous human message and the
 * answer, in tool-call order.
 */
import type { Message } from "@langchain/langgraph-sdk";

import type { KnowledgeCitation } from "./types";

const RETRIEVAL_TOOLS = new Set(["hybrid_search", "wiki_search", "graph_search"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toCitation(value: unknown, fallbackName: string | undefined, sourceType: "chunk" | "wiki"): KnowledgeCitation | null {
  const record = asRecord(value);
  if (!record) return null;
  const chunkId = record.chunk_id ?? record.entry_id;
  const text = record.text ?? record.content;
  if (typeof chunkId !== "string" || typeof text !== "string") return null;
  return {
    chunk_id: chunkId,
    doc_name: typeof record.doc_name === "string" ? record.doc_name : (fallbackName ?? ""),
    page: typeof record.page === "number" ? record.page : null,
    heading_path: Array.isArray(record.heading_path) ? (record.heading_path as string[]) : [],
    text,
    score: typeof record.score === "number" ? record.score : 0,
    source_type: sourceType,
  };
}

/** Parse one retrieval tool message payload into citations (bad input → []). */
export function parseRetrievalToolContent(toolName: string | null | undefined, content: unknown): KnowledgeCitation[] {
  if (!toolName || !RETRIEVAL_TOOLS.has(toolName)) {
    return [];
  }
  let payload: unknown = content;
  if (typeof content === "string") {
    try {
      payload = JSON.parse(content);
    } catch {
      return [];
    }
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const key = toolName === "hybrid_search" ? "results" : toolName === "wiki_search" ? "entries" : "evidence";
  // source_type is derived from the tool the payload came through — zero
  // backend change (phase-2 batch-1, spec §4).
  const sourceType = toolName === "wiki_search" ? "wiki" : "chunk";
  const items = Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
  return items
    .map((item) => toCitation(item, typeof asRecord(item)?.title === "string" ? (asRecord(item)?.title as string) : undefined, sourceType))
    .filter((citation): citation is KnowledgeCitation => citation !== null);
}

/**
 * Sources for one assistant answer: every retrieval tool message between the
 * preceding human message and that answer, merged in order and deduped by
 * chunk_id (first recall wins — it carries the better rank).
 */
export function sourcesForAssistantMessage(
  messages: readonly Message[],
  assistantMessageId: string | undefined,
): KnowledgeCitation[] {
  if (!assistantMessageId) {
    return [];
  }
  const answerIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (answerIndex < 0) {
    return [];
  }
  let turnStart = 0;
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === "human") {
      turnStart = index + 1;
      break;
    }
  }
  const seen = new Set<string>();
  const sources: KnowledgeCitation[] = [];
  for (let index = turnStart; index < answerIndex; index += 1) {
    const message = messages[index];
    if (message?.type !== "tool") {
      continue;
    }
    const toolName = (message as { name?: string }).name;
    for (const citation of parseRetrievalToolContent(toolName, message.content)) {
      if (seen.has(citation.chunk_id)) {
        continue;
      }
      seen.add(citation.chunk_id);
      sources.push(citation);
    }
  }
  return sources;
}
