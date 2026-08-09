/**
 * Citation extraction from retrieval tool messages (spec §4.6): the rag
 * agent's tools return JSON payloads — hybrid_search ``results`` (chunk
 * level), graph_search ``evidence`` (chunk level), wiki_search ``entries``
 * (entry level). The assistant's ``[n]`` markers map onto the merged,
 * deduped source list of its own turn.
 */
import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, test } from "@rstest/core";

import {
  parseRetrievalToolContent,
  sourcesForAssistantMessage,
} from "@/core/knowledge/citations";

function toolMessage(name: string, payload: unknown, id: string): Message {
  return {
    type: "tool",
    id,
    name,
    content: typeof payload === "string" ? payload : JSON.stringify(payload),
  } as unknown as Message;
}

function human(id: string): Message {
  return { type: "human", id, content: "问题" } as unknown as Message;
}

function ai(id: string): Message {
  return { type: "ai", id, content: "回答 [1]" } as unknown as Message;
}

const HYBRID = {
  results: [
    { chunk_id: "c1", doc_name: "手册.pdf", page: 3, heading_path: ["第一章"], text: "切片一", score: 0.9 },
    { chunk_id: "c2", doc_name: "白皮书.md", page: null, heading_path: [], text: "切片二", score: 0.8 },
  ],
  message: "检索到 2 条相关切片。",
};

const WIKI = {
  entries: [{ entry_id: "e1", title: "DeerFlow", content: "条目全文", score: 0.7, updated_at: "2026-08-09" }],
  message: "命中 1 篇百科条目。",
};

const GRAPH = {
  entities: [],
  relations: [],
  evidence: [{ chunk_id: "c3", text: "证据切片", doc_name: "手册.pdf", heading_path: ["第二章"], page: 5 }],
  message: "命中 1 个实体。",
};

describe("parseRetrievalToolContent", () => {
  test("parses hybrid_search results into chunk citations", () => {
    const citations = parseRetrievalToolContent("hybrid_search", JSON.stringify(HYBRID));
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ chunk_id: "c1", doc_name: "手册.pdf", page: 3, text: "切片一" });
  });

  test("parses wiki_search entries into entry citations (title as source name)", () => {
    const citations = parseRetrievalToolContent("wiki_search", JSON.stringify(WIKI));
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ chunk_id: "e1", doc_name: "DeerFlow", text: "条目全文", page: null });
  });

  test("parses graph_search evidence into chunk citations", () => {
    const citations = parseRetrievalToolContent("graph_search", JSON.stringify(GRAPH));
    expect(citations[0]).toMatchObject({ chunk_id: "c3", doc_name: "手册.pdf", text: "证据切片" });
  });

  test("tolerates malformed JSON and unknown tools by returning nothing", () => {
    expect(parseRetrievalToolContent("hybrid_search", "not-json")).toEqual([]);
    expect(parseRetrievalToolContent("web_search", JSON.stringify(HYBRID))).toEqual([]);
    expect(parseRetrievalToolContent("hybrid_search", JSON.stringify({ results: [], message: "空" }))).toEqual([]);
  });
});

describe("sourcesForAssistantMessage", () => {
  test("merges retrieval results between the previous human message and the answer, deduped by chunk_id", () => {
    const messages = [
      human("h1"),
      toolMessage("hybrid_search", HYBRID, "t1"),
      toolMessage("wiki_search", WIKI, "t2"),
      toolMessage("graph_search", GRAPH, "t3"),
      ai("a1"),
    ];
    const sources = sourcesForAssistantMessage(messages, "a1");
    expect(sources.map((s) => s.chunk_id)).toEqual(["c1", "c2", "e1", "c3"]);
  });

  test("scopes to the message's own turn (earlier turns are invisible)", () => {
    const messages = [
      human("h1"),
      toolMessage("hybrid_search", HYBRID, "t1"),
      ai("a1"),
      human("h2"),
      toolMessage("wiki_search", WIKI, "t2"),
      ai("a2"),
    ];
    expect(sourcesForAssistantMessage(messages, "a2").map((s) => s.chunk_id)).toEqual(["e1"]);
    expect(sourcesForAssistantMessage(messages, "a1").map((s) => s.chunk_id)).toEqual(["c1", "c2"]);
  });

  test("dedupes the same chunk recalled by two paths", () => {
    const graphSame = { ...GRAPH, evidence: [{ ...GRAPH.evidence[0], chunk_id: "c1" }] };
    const messages = [
      human("h1"),
      toolMessage("hybrid_search", HYBRID, "t1"),
      toolMessage("graph_search", graphSame, "t3"),
      ai("a1"),
    ];
    expect(sourcesForAssistantMessage(messages, "a1").map((s) => s.chunk_id)).toEqual(["c1", "c2"]);
  });

  test("returns nothing for an answer without retrieval", () => {
    const messages = [human("h1"), ai("a1")];
    expect(sourcesForAssistantMessage(messages, "a1")).toEqual([]);
  });
});
