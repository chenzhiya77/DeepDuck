import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, test } from "@rstest/core";

import type { PetWorkKind } from "@/core/pet/state";
import {
  classifyTool,
  collectActiveToolNames,
  pickWorkKind,
} from "@/core/pet/tools";

function aiWithCalls(
  toolCalls: Array<{ id: string; name: string }>,
  content = "",
): Message {
  return {
    id: `ai-${toolCalls.map((c) => c.id).join("-")}`,
    type: "ai",
    content,
    tool_calls: toolCalls.map((c) => ({ ...c, args: {} })),
  } as Message;
}

function toolResult(callId: string, content: string): Message {
  return {
    id: `tool-${callId}`,
    type: "tool",
    content,
    tool_call_id: callId,
  } as Message;
}

describe("collectActiveToolNames", () => {
  test("returns every name of a parallel tool-call turn", () => {
    const messages = [
      aiWithCalls([
        { id: "c1", name: "bash" },
        { id: "c2", name: "read_file" },
        { id: "c3", name: "task" },
      ]),
    ];

    expect(collectActiveToolNames(messages)).toEqual([
      "bash",
      "read_file",
      "task",
    ]);
  });

  test("drops tool calls that already have a result", () => {
    const messages = [
      aiWithCalls([
        { id: "c1", name: "bash" },
        { id: "c2", name: "read_file" },
      ]),
      toolResult("c1", "done"),
    ];

    expect(collectActiveToolNames(messages)).toEqual(["read_file"]);
  });

  // spec §15 开放项 1: findToolCallResult returns undefined for an empty
  // ToolMessage too, which would misread a finished empty result as in-flight.
  test("counts a ToolMessage with empty content as answered", () => {
    const messages = [
      aiWithCalls([{ id: "c1", name: "bash" }]),
      toolResult("c1", ""),
    ];

    expect(collectActiveToolNames(messages)).toEqual([]);
  });

  test("ignores an orphan ToolMessage with no preceding AI message", () => {
    const messages = [toolResult("c9", "orphan")];

    expect(collectActiveToolNames(messages)).toEqual([]);
  });

  test("returns an empty array for an empty transcript", () => {
    expect(collectActiveToolNames([])).toEqual([]);
  });
});

describe("classifyTool", () => {
  const CASES: Array<[PetWorkKind, string[]]> = [
    ["exec", ["bash", "invoke_acp_agent"]],
    [
      "read",
      ["read_file", "ls", "glob", "grep", "view_image"],
    ],
    ["write", ["write_file", "str_replace", "present_files"]],
    [
      "browse",
      [
        "web_search",
        "web_fetch",
        "image_search",
        "web_capture",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
        "browser_get_text",
        "browser_back",
        "browser_screenshot",
        "browser_close",
      ],
    ],
    [
      "recall",
      [
        "hybrid_search",
        "graph_search",
        "wiki_search",
        "memory_search",
        "describe_skill",
        "tool_search",
      ],
    ],
    ["delegate", ["task"]],
  ];

  for (const [kind, names] of CASES) {
    test(`maps ${names.join(" / ")} to ${kind}`, () => {
      for (const name of names) {
        expect(classifyTool(name)).toBe(kind);
      }
    });
  }

  test("falls back to generic for an unknown MCP tool name", () => {
    expect(classifyTool("github_list_prs")).toBe("generic");
    expect(classifyTool("some_server_do_thing")).toBe("generic");
  });
});

describe("pickWorkKind", () => {
  const SAMPLE: Record<PetWorkKind, string> = {
    delegate: "task",
    exec: "bash",
    write: "write_file",
    browse: "web_search",
    recall: "hybrid_search",
    read: "read_file",
    generic: "github_list_prs",
  };
  const ORDER: PetWorkKind[] = [
    "delegate",
    "exec",
    "write",
    "browse",
    "recall",
    "read",
    "generic",
  ];

  for (let hi = 0; hi < ORDER.length; hi += 1) {
    const winner = ORDER[hi];
    if (!winner) continue;
    for (const loser of ORDER.slice(hi + 1)) {
      test(`${winner} beats ${loser} in either order`, () => {
        expect(pickWorkKind([SAMPLE[winner], SAMPLE[loser]])).toBe(winner);
        expect(pickWorkKind([SAMPLE[loser], SAMPLE[winner]])).toBe(winner);
      });
    }
  }

  test("returns null when nothing is in flight", () => {
    expect(pickWorkKind([])).toBeNull();
  });

  // spec §15 开放项 10: deriving in-flight tools from getMessageGroups would
  // make delegate a permanently dead branch. This anchor keeps it reachable.
  test("surfaces delegate when a task call shares a turn with other tools", () => {
    const messages = [
      aiWithCalls([
        { id: "c1", name: "present_files" },
        { id: "c2", name: "task" },
        { id: "c3", name: "bash" },
      ]),
      toolResult("c1", "presented"),
      toolResult("c3", "done"),
    ];

    expect(pickWorkKind(collectActiveToolNames(messages))).toBe("delegate");
  });
});
