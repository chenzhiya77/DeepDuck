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

  test("stamps source_type from the tool name (phase-2 batch-1: zero backend change)", () => {
    expect(parseRetrievalToolContent("hybrid_search", JSON.stringify(HYBRID))[0]?.source_type).toBe("chunk");
    expect(parseRetrievalToolContent("graph_search", JSON.stringify(GRAPH))[0]?.source_type).toBe("chunk");
    expect(parseRetrievalToolContent("wiki_search", JSON.stringify(WIKI))[0]?.source_type).toBe("wiki");
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

  test("carries the backend citation_no through parsing", () => {
    const hybrid = {
      results: [{ chunk_id: "c1", doc_name: "手册.pdf", page: 3, heading_path: [], text: "切片", score: 0.9, citation_no: 4 }],
    };
    const graph = {
      entities: [],
      relations: [],
      evidence: [{ chunk_id: "c3", text: "证据", doc_name: "手册.pdf", heading_path: [], page: 5, citation_no: 9 }],
    };
    const wiki = {
      entries: [{ entry_id: "e1", title: "条目", content: "全文", score: 0.7, citation_no: 1 }],
    };
    expect(parseRetrievalToolContent("hybrid_search", JSON.stringify(hybrid))[0]?.citation_nos).toEqual([4]);
    expect(parseRetrievalToolContent("graph_search", JSON.stringify(graph))[0]?.citation_nos).toEqual([9]);
    expect(parseRetrievalToolContent("wiki_search", JSON.stringify(wiki))[0]?.citation_nos).toEqual([1]);
  });

  test("dedupe merges citation numbers of every path onto one source (production overlap repro)", () => {
    // Production repro: graph and hybrid recalled the SAME chunks, and the
    // backend assigned each path its own citation_no range (hybrid 4-8,
    // graph 9-12). Dedupe must keep one card per chunk while preserving BOTH
    // numbers — otherwise the model's [9]-[12] marks dangle.
    const wiki3 = {
      entries: [1, 2, 3].map((n) => ({ entry_id: `e${n}`, title: `条目${n}`, content: "全文", score: 0.7, citation_no: n })),
    };
    const graph4 = {
      entities: [],
      relations: [],
      evidence: [
        { chunk_id: "cA", text: "证据A", doc_name: "a.md", heading_path: [], page: null, citation_no: 9 },
        { chunk_id: "cB", text: "证据B", doc_name: "b.md", heading_path: [], page: null, citation_no: 10 },
        { chunk_id: "cC", text: "证据C", doc_name: "c.md", heading_path: [], page: null, citation_no: 11 },
        { chunk_id: "cD", text: "证据D", doc_name: "d.md", heading_path: [], page: null, citation_no: 12 },
      ],
    };
    const hybrid5 = {
      results: [
        { chunk_id: "cA", doc_name: "a.md", page: null, heading_path: [], text: "切片A", score: 0.9, citation_no: 4 },
        { chunk_id: "cB", doc_name: "b.md", page: null, heading_path: [], text: "切片B", score: 0.8, citation_no: 5 },
        { chunk_id: "cD", doc_name: "d.md", page: null, heading_path: [], text: "切片D", score: 0.7, citation_no: 6 },
        { chunk_id: "cC", doc_name: "c.md", page: null, heading_path: [], text: "切片C", score: 0.6, citation_no: 7 },
        { chunk_id: "cE", doc_name: "e.md", page: null, heading_path: [], text: "切片E", score: 0.5, citation_no: 8 },
      ],
    };
    const messages = [
      human("h1"),
      toolMessage("wiki_search", wiki3, "t1"),
      toolMessage("graph_search", graph4, "t2"),
      toolMessage("hybrid_search", hybrid5, "t3"),
      ai("a1"),
    ];
    const sources = sourcesForAssistantMessage(messages, "a1");
    // 3 wiki + 4 graph chunks + 1 hybrid-only chunk (cE) — overlap collapses.
    expect(sources).toHaveLength(8);
    // Sorted by each card's smallest citation_no (NOT tool-completion order),
    // so the array position is the stable display number: e1..e3 (1-3), then
    // cA(4) cB(5) cD(6) cC(7) cE(8).
    expect(sources.map((s) => s.chunk_id)).toEqual(["e1", "e2", "e3", "cA", "cB", "cD", "cC", "cE"]);
    const byId = new Map(sources.map((s) => [s.chunk_id, s]));
    expect(byId.get("cA")?.citation_nos).toEqual([9, 4]);
    expect(byId.get("cB")?.citation_nos).toEqual([10, 5]);
    expect(byId.get("cD")?.citation_nos).toEqual([12, 6]);
    expect(byId.get("cC")?.citation_nos).toEqual([11, 7]);
    expect(byId.get("cE")?.citation_nos).toEqual([8]);
    // Every citation_no the model may cite resolves to exactly one source.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(sources.some((s) => s.citation_nos?.includes(n))).toBe(true);
    }
  });

  test("sorts cards by their smallest citation_no regardless of tool-completion order", () => {
    // Production: tools finish in any order (graph first here), and the strip
    // used to follow completion order — so wiki cards (citation_no 1-2) could
    // land behind chunk cards (3-4). Display numbers are the SORTED array
    // positions, keeping the strip order stable across runs.
    const wiki = {
      entries: [1, 2].map((n) => ({ entry_id: `e${n}`, title: `条目${n}`, content: "全文", score: 0.7, citation_no: n })),
    };
    const graph = {
      entities: [],
      relations: [],
      evidence: [{ chunk_id: "cA", text: "证据", doc_name: "a.md", heading_path: [], page: null, citation_no: 4 }],
    };
    const hybrid = {
      results: [{ chunk_id: "cB", doc_name: "b.md", page: null, heading_path: [], text: "切片", score: 0.9, citation_no: 3 }],
    };
    const messages = [
      human("h1"),
      toolMessage("graph_search", graph, "t1"),
      toolMessage("hybrid_search", hybrid, "t2"),
      toolMessage("wiki_search", wiki, "t3"),
      ai("a1"),
    ];
    expect(sourcesForAssistantMessage(messages, "a1").map((s) => s.chunk_id)).toEqual(["e1", "e2", "cB", "cA"]);
  });

  test("returns nothing for an answer without retrieval", () => {
    const messages = [human("h1"), ai("a1")];
    expect(sourcesForAssistantMessage(messages, "a1")).toEqual([]);
  });
});
