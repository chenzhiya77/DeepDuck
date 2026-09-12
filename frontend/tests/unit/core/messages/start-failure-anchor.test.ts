import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, test } from "@rstest/core";

import { getStartFailureAnchorGroupIndices } from "@/core/messages/start-failure-anchor";
import { getMessageGroups } from "@/core/messages/utils";
import { START_FAILURE_KWARG } from "@/core/run-status/start-failure";

/**
 * Where a failed start's notice is drawn.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.1. The notice belongs under the reader's own message — the one whose run
 * never started — so the anchor is "the message carrying the verdict", not
 * "whichever user turn happens to be last". The two differ in the direction that
 * matters: a trailing turn with no verdict on it is an ordinary message the
 * notice has nothing to say about, and pointing at it would put this failure
 * under the wrong turn.
 */
const VERDICT = {
  kind: "occupied",
  action: "stop",
  message: "HTTP 409",
} as const;

function human(id: string, text = "Hello"): Message {
  return { id, type: "human", content: text } as Message;
}

function markedHuman(id: string, text = "Hello"): Message {
  return {
    id,
    type: "human",
    content: text,
    additional_kwargs: { [START_FAILURE_KWARG]: VERDICT },
  } as Message;
}

function assistant(id: string, runId: string): Message {
  return { id, type: "ai", content: "Working on it", run_id: runId } as Message;
}

describe("failed-start notice placement", () => {
  test("anchors on the human message that carries a verdict", () => {
    const groups = getMessageGroups([markedHuman("human-1")]);

    expect([...getStartFailureAnchorGroupIndices(groups)]).toEqual([0]);
  });

  test("ignores a trailing human turn that carries no verdict", () => {
    // Every normal send looks like this before the server answers. Nothing
    // failed, so there is nothing to anchor.
    const groups = getMessageGroups([human("human-1")]);

    expect([...getStartFailureAnchorGroupIndices(groups)]).toEqual([]);
  });

  test("points at the marked turn rather than the last one", () => {
    // What the structural rule ("the last human, nothing after it") gets wrong:
    // whichever turn comes last is not the turn that failed.
    const groups = getMessageGroups([
      markedHuman("human-1"),
      human("human-2", "Tried again"),
    ]);

    expect([...getStartFailureAnchorGroupIndices(groups)]).toEqual([0]);
  });

  test("does not anchor a run's answer", () => {
    const groups = getMessageGroups([
      human("human-1"),
      assistant("ai-1", "run-1"),
    ]);

    expect([...getStartFailureAnchorGroupIndices(groups)]).toEqual([]);
  });

  test("anchors nothing when there is nothing to anchor to", () => {
    expect([...getStartFailureAnchorGroupIndices([])]).toEqual([]);
  });
});
