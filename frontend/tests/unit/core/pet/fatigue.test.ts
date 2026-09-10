import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, test } from "@rstest/core";

import {
  collectFatigueInput,
  computeFatigueLevel,
  type FatigueInput,
} from "@/core/pet/fatigue";

function input(overrides: Partial<FatigueInput> = {}): FatigueInput {
  return {
    toolCallCount: 0,
    maxConsecutiveSameTool: 0,
    toolErrorCount: 0,
    unrecoverableErrorCount: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

const MINUTE = 60_000;

function aiWithCalls(names: string[]): Message {
  return {
    id: `ai-${names.join("-")}`,
    type: "ai",
    content: "",
    tool_calls: names.map((name, i) => ({ id: `${name}-${i}`, name, args: {} })),
  } as Message;
}

function toolResult(
  callId: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `tool-${callId}`,
    type: "tool",
    content: "result",
    tool_call_id: callId,
    additional_kwargs: meta ? { deerflow_tool_meta: meta } : {},
  } as Message;
}

const ERROR_META = {
  status: "error",
  error_type: "no_results",
  recoverable_by_model: true,
  recommended_next_action: "rewrite_query",
  source: "tool_return",
};
const UNRECOVERABLE_META = {
  status: "error",
  error_type: "auth",
  recoverable_by_model: false,
  recommended_next_action: "stop",
  source: "exception",
};
const SUCCESS_META = {
  status: "success",
  error_type: null,
  recoverable_by_model: true,
  recommended_next_action: "continue",
  source: "content_analysis",
};

describe("computeFatigueLevel sub-score bands", () => {
  const CASES: Array<[keyof Omit<FatigueInput, "elapsedMs"> | "elapsedMs", number, number[]]> = [
    ["toolCallCount", 0, [4]],
    ["toolCallCount", 1, [5, 14]],
    ["toolCallCount", 2, [15, 34]],
    ["toolCallCount", 3, [35]],
    ["maxConsecutiveSameTool", 0, [2]],
    ["maxConsecutiveSameTool", 1, [3, 4]],
    ["maxConsecutiveSameTool", 2, [5, 7]],
    ["maxConsecutiveSameTool", 3, [8]],
    ["toolErrorCount", 0, [0]],
    ["toolErrorCount", 1, [1]],
    ["toolErrorCount", 2, [2, 3]],
    ["toolErrorCount", 3, [4]],
    ["unrecoverableErrorCount", 0, [0]],
    ["unrecoverableErrorCount", 1, [1]],
    ["unrecoverableErrorCount", 3, [2]],
    ["elapsedMs", 0, [0, 2 * MINUTE - 1]],
    ["elapsedMs", 1, [2 * MINUTE, 10 * MINUTE - 1]],
    ["elapsedMs", 2, [10 * MINUTE, 30 * MINUTE - 1]],
    ["elapsedMs", 3, [30 * MINUTE]],
  ];

  for (const [field, expected, values] of CASES) {
    for (const value of values) {
      test(`${field}=${value} -> ${expected}`, () => {
        expect(computeFatigueLevel(input({ [field]: value }))).toBe(expected);
      });
    }
  }

  test("caps every sub-score at 3 instead of growing past it", () => {
    const huge = 1_000_000;
    expect(computeFatigueLevel(input({ toolCallCount: huge }))).toBe(3);
    expect(computeFatigueLevel(input({ maxConsecutiveSameTool: huge }))).toBe(3);
    expect(computeFatigueLevel(input({ toolErrorCount: huge }))).toBe(3);
    expect(computeFatigueLevel(input({ unrecoverableErrorCount: huge }))).toBe(3);
    expect(computeFatigueLevel(input({ elapsedMs: huge * MINUTE }))).toBe(3);
  });

  test("takes the max across sub-scores, not the sum", () => {
    // Four signals each at level 1: max is 1, while a sum (4) would clamp to 3.
    expect(
      computeFatigueLevel(
        input({
          toolCallCount: 5,
          maxConsecutiveSameTool: 3,
          toolErrorCount: 1,
          elapsedMs: 2 * MINUTE,
        }),
      ),
    ).toBe(1);
  });

  test("is 0 when every signal is at its floor", () => {
    expect(computeFatigueLevel(input())).toBe(0);
  });
});

describe("collectFatigueInput", () => {
  test("counts every issued tool call across turns", () => {
    const messages = [
      aiWithCalls(["bash", "read_file"]),
      toolResult("bash-0"),
      toolResult("read_file-1"),
      aiWithCalls(["write_file"]),
    ];

    expect(collectFatigueInput(messages).toolCallCount).toBe(3);
  });

  test("measures the longest run of the same tool name", () => {
    const messages = [
      aiWithCalls(["read_file", "read_file"]),
      aiWithCalls(["read_file", "bash", "read_file"]),
    ];

    expect(collectFatigueInput(messages).maxConsecutiveSameTool).toBe(3);
  });

  test("splits recoverable errors from unrecoverable ones via deerflow_tool_meta", () => {
    const messages = [
      aiWithCalls(["bash", "read_file", "web_search"]),
      toolResult("bash-0", ERROR_META),
      toolResult("read_file-1", UNRECOVERABLE_META),
      toolResult("web_search-2", SUCCESS_META),
    ];

    const signals = collectFatigueInput(messages);

    expect(signals.toolErrorCount).toBe(2);
    expect(signals.unrecoverableErrorCount).toBe(1);
  });

  test("treats a missing deerflow_tool_meta as zero errors", () => {
    const messages = [
      aiWithCalls(["bash"]),
      toolResult("bash-0"),
    ];

    const signals = collectFatigueInput(messages);

    expect(signals.toolErrorCount).toBe(0);
    expect(signals.unrecoverableErrorCount).toBe(0);
  });

  test("does not count a partial_success result as an error", () => {
    const messages = [
      aiWithCalls(["hybrid_search"]),
      toolResult("hybrid_search-0", {
        status: "partial_success",
        error_type: null,
        recoverable_by_model: true,
        recommended_next_action: "rewrite_query",
        source: "content_analysis",
      }),
    ];

    expect(collectFatigueInput(messages).toolErrorCount).toBe(0);
  });

  test("returns an all-zero signal set for an empty transcript", () => {
    expect(collectFatigueInput([])).toEqual({
      toolCallCount: 0,
      maxConsecutiveSameTool: 0,
      toolErrorCount: 0,
      unrecoverableErrorCount: 0,
    });
  });
});
