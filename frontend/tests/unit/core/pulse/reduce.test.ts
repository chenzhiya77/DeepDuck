import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "@rstest/core";

import { reducePulse } from "@/core/pulse/reduce";

/**
 * The pulse's rule table, as pure logic.
 *
 * Spec: docs/superpowers/specs/2026-09-13-harness-live-pulse-design.md §2 D2/§4.
 * It reads the state the app already holds for the run in flight — no
 * subscription of its own — and answers two questions: which ring segment the
 * pointer sits on, and how many laps it has run.
 *
 * The lap count is measured against the backend's own counter rather than
 * guessed: a probe over three real runs found the count of distinct
 * root-namespace AI message ids equal to `llm_call_index` every time (2=2, 2=2,
 * 1=1), while counting namespaced frames would have said 4.
 */
const human = (id: string): Message =>
  ({ id, type: "human", content: "do the thing" }) as Message;

const ai = (
  id: string,
  { toolCalls = false }: { toolCalls?: boolean } = {},
): Message =>
  ({
    id,
    type: "ai",
    content: toolCalls ? "" : "here is the answer",
    ...(toolCalls
      ? {
          tool_calls: [
            { id: `call-${id}`, name: "bash", args: { command: "ls" } },
          ],
        }
      : {}),
  }) as Message;

const tool = (id: string, callId: string): Message =>
  ({ id, type: "tool", content: "ok", tool_call_id: callId }) as Message;

/** One model→tools round trip. */
const roundTrip = (n: number): Message[] => [
  ai(`ai-tools-${n}`, { toolCalls: true }),
  tool(`tool-${n}`, `call-ai-tools-${n}`),
];

describe("reducePulse", () => {
  it("says nothing when there is nothing to reason about", () => {
    expect(reducePulse([], { finished: false })).toBeNull();
  });

  it("parks at the first segment before any model response", () => {
    // `intake` covers `context` too: the two are indistinguishable from the
    // message stream, and the spec accepts that approximation (risk 1).
    expect(reducePulse([human("h1")], { finished: false })).toEqual({
      stageKey: "intake",
      lap: 0,
    });
  });

  it("moves to tools while a tool-calling response is the latest word", () => {
    expect(
      reducePulse([human("h1"), ai("ai-tools-1", { toolCalls: true })], {
        finished: false,
      }),
    ).toEqual({ stageKey: "tools", lap: 1 });
  });

  it("returns to model once a response carries no tool call", () => {
    expect(
      reducePulse([human("h1"), ...roundTrip(1), ai("ai-answer")], {
        finished: false,
      }),
    ).toEqual({ stageKey: "model", lap: 1 });
  });

  it("parks on the exit arc once the run is over", () => {
    expect(
      reducePulse([human("h1"), ...roundTrip(1), ai("ai-answer")], {
        finished: true,
      }),
    ).toEqual({ stageKey: "epilogue", lap: 1 });
  });

  it("counts one lap per round trip, not per message", () => {
    const messages = [
      human("h1"),
      ...roundTrip(1),
      ...roundTrip(2),
      ...roundTrip(3),
      ai("ai-answer"),
    ];

    expect(reducePulse(messages, { finished: false })).toEqual({
      stageKey: "model",
      lap: 3,
    });
  });

  it("counts only assistant turns", () => {
    // A tool result carries a `tool_call_id` and no tool_calls of its own; a
    // stray one must not inflate the lap count, which is measured against the
    // backend's per-response counter.
    const messages = [
      human("h1"),
      tool("tool-1", "call-1"),
      tool("tool-2", "call-2"),
    ];

    expect(reducePulse(messages, { finished: false })).toEqual({
      stageKey: "intake",
      lap: 0,
    });
  });
});
