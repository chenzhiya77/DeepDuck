import { describe, expect, it } from "@rstest/core";

import {
  gateEventKey,
  mergeGateEvents,
  parseGateFrame,
  parseGateRow,
  type GateNotification,
} from "@/core/constitution/gate-events";

/**
 * The two legs a gate event arrives on, normalized into one shape.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.3
 */
const frame = (overrides: Record<string, unknown> = {}) => ({
  type: "read_gate",
  name: "ReadBeforeWriteMiddleware",
  hook: "wrap_tool_call",
  action: "block",
  changes: { tool_name: "write_file", path: "/mnt/user-data/workspace/a.md" },
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  event_type: "middleware:read_gate",
  content: {
    name: "ReadBeforeWriteMiddleware",
    hook: "wrap_tool_call",
    action: "block",
    changes: { tool_name: "write_file", path: "/mnt/user-data/workspace/a.md" },
  },
  seq: 7,
  ...overrides,
});

describe("parseGateFrame", () => {
  it("normalizes a live custom frame", () => {
    expect(parseGateFrame(frame())).toEqual({
      tag: "read_gate",
      name: "ReadBeforeWriteMiddleware",
      hook: "wrap_tool_call",
      action: "block",
      changes: {
        tool_name: "write_file",
        path: "/mnt/user-data/workspace/a.md",
      },
    });
  });

  it("drops unknown tags and malformed frames instead of throwing", () => {
    expect(parseGateFrame(frame({ type: "task_running" }))).toBeNull();
    expect(parseGateFrame({ type: "read_gate" })).toBeNull(); // no name
    expect(parseGateFrame(null)).toBeNull();
    expect(parseGateFrame("read_gate")).toBeNull();
  });

  it("tolerates a missing changes payload", () => {
    expect(parseGateFrame(frame({ changes: undefined }))?.changes).toEqual({});
  });
});

describe("parseGateRow", () => {
  it("normalizes a persisted middleware row and keeps its seq", () => {
    expect(parseGateRow(row())).toEqual({
      tag: "read_gate",
      name: "ReadBeforeWriteMiddleware",
      hook: "wrap_tool_call",
      action: "block",
      changes: {
        tool_name: "write_file",
        path: "/mnt/user-data/workspace/a.md",
      },
      seq: 7,
    });
  });

  it("ignores rows that are not gate events", () => {
    expect(parseGateRow({ event_type: "run.start", content: {} })).toBeNull();
    expect(
      parseGateRow({ event_type: "middleware:guardrail", content: {} }),
    ).toBeNull();
    expect(
      parseGateRow({ event_type: "middleware:read_gate", content: "oops" }),
    ).toBeNull();
  });
});

describe("mergeGateEvents", () => {
  const older = parseGateRow(row({ seq: 2 }))!;
  const newer = parseGateRow(
    row({
      seq: 5,
      content: { ...row().content, changes: { tool_name: "str_replace" } },
    }),
  )!;

  it("orders the persisted leg by seq, oldest first", () => {
    const merged = mergeGateEvents([newer, older], []);
    expect(merged.map((event) => event.seq)).toEqual([2, 5]);
  });

  it("keeps live events in arrival order after the persisted ones", () => {
    const first = parseGateFrame(frame({ changes: { path: "/a" } }))!;
    const second = parseGateFrame(frame({ changes: { path: "/b" } }))!;
    const merged = mergeGateEvents([older], [first, second]);
    expect(merged.map((event) => event.changes.path)).toEqual([
      "/mnt/user-data/workspace/a.md",
      "/a",
      "/b",
    ]);
  });

  it("folds an event that arrived on both legs", () => {
    const live: GateNotification = parseGateFrame(frame())!;
    const persisted: GateNotification = parseGateRow(row())!;
    expect(gateEventKey(live)).toBe(gateEventKey(persisted));
    expect(mergeGateEvents([persisted], [live])).toHaveLength(1);
  });

  it("keeps events that differ only in their decision facts", () => {
    const live = parseGateFrame(frame({ changes: { path: "/other" } }))!;
    const persisted = parseGateRow(row())!;
    expect(mergeGateEvents([persisted], [live])).toHaveLength(2);
  });
});
