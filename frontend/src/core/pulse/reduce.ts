import type { Message } from "@langchain/langgraph-sdk";

import type { PulseState } from "./types";

/**
 * Where the run in flight is, derived from the messages the app already holds.
 *
 * Spec: docs/superpowers/specs/2026-09-13-harness-live-pulse-design.md §2 D2 / §4.
 * Pure on purpose and free of React: this is the only place the pulse judges, and
 * its answer is read by two tiers plus the ring.
 *
 * `lap` counts assistant turns that asked for a tool — one lap is one
 * model→tools round trip. That count is measured against the backend's own
 * counter rather than invented: the probe in the spec (§7) found the number of
 * assistant turns equal to `llm_call_index` on three real runs, and unequal only
 * when subagent frames were counted too. Those frames never reach this list (this
 * app does not request subgraph streaming), so root-only-ness is a property of the
 * input, not something to re-check here.
 *
 * `intake` stands in for `context` as well: the message stream cannot tell the two
 * apart, which is the approximation the spec accepts.
 */
export function reducePulse(
  messages: readonly Message[],
  { finished }: { finished: boolean },
): PulseState | null {
  if (messages.length === 0) {
    return null;
  }

  const assistantTurns = messages.filter((message) => message.type === "ai");
  const lap = assistantTurns.filter(askedForATool).length;

  if (finished) {
    return { stageKey: "epilogue", lap };
  }
  const latest = assistantTurns[assistantTurns.length - 1];
  if (!latest) {
    return { stageKey: "intake", lap };
  }
  return { stageKey: askedForATool(latest) ? "tools" : "model", lap };
}

function askedForATool(message: Message): boolean {
  const toolCalls = Reflect.get(message, "tool_calls");
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}
