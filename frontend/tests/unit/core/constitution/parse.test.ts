import { describe, expect, it } from "@rstest/core";

import { parseConstitution, splitStages } from "@/core/constitution/parse";

/**
 * Reading the snapshot off the run event stream.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.2
 */
const stage = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  loop: ["context", "model", "tools"].includes(key),
  members: 1,
  gates: 0,
  handoff_gates: 0,
  ...overrides,
});

const record = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  model: {
    name: "qwen3.8-flash",
    thinking_enabled: true,
    reasoning_effort: null,
  },
  agent: { name: "rag", is_bootstrap: false },
  checkpoint_mode: "full",
  runtime_flags: { is_plan_mode: false },
  stages: [stage("intake"), stage("context")],
  middlewares: [
    {
      name: "ThreadDataMiddleware",
      stage: "intake",
      kind: "member",
      hooks: ["before_agent"],
      frequency: "once_per_run",
    },
  ],
  tools: {
    mounted: [{ name: "hybrid_search", source: "tool_group", group: "rag" }],
    mounted_count: 1,
    deferred_names: [],
    deferred_count: 0,
    auto_promote_top_k: 3,
    truncated: false,
  },
  tool_authorization: { removed: [], removed_count: 0 },
  skills: {
    available_count: 8,
    deferred_discovery: false,
    describe_skill_bound: false,
  },
  mcp_routing_built: true,
  ...overrides,
});

const rowWith = (content: unknown) => ({
  event_type: "run.start",
  content,
  seq: 1,
});

describe("parseConstitution", () => {
  it("returns null when no row carries a snapshot", () => {
    expect(parseConstitution([])).toBeNull();
    expect(parseConstitution([rowWith({ chain: "root" })])).toBeNull();
    expect(parseConstitution([rowWith({ constitution: "nope" })])).toBeNull();
  });

  it("reads the first row that carries one, not the first row", () => {
    const rows = [
      rowWith({ chain: "root" }),
      {
        event_type: "run.start",
        content: { chain: "root", constitution: record() },
        seq: 2,
      },
      {
        event_type: "run.start",
        content: {
          chain: "root",
          constitution: record({
            agent: { name: "later", is_bootstrap: false },
          }),
        },
        seq: 9,
      },
    ];

    expect(parseConstitution(rows)?.agent.name).toBe("rag");
  });

  it("keeps parsing a newer schema version with the known fields", () => {
    const parsed = parseConstitution([
      rowWith({
        constitution: record({ schema_version: 2, something_new: { a: 1 } }),
      }),
    ]);

    expect(parsed?.schema_version).toBe(2);
    expect(parsed?.middlewares[0]?.name).toBe("ThreadDataMiddleware");
    expect(parsed && "something_new" in parsed).toBe(false);
  });

  it("lifts the truncation marker from the top level and from tools", () => {
    expect(
      parseConstitution([
        rowWith({ constitution: record({ truncated: true }) }),
      ])?.truncated,
    ).toBe(true);
    expect(
      parseConstitution([
        rowWith({
          constitution: record({
            tools: { ...record().tools, truncated: true },
          }),
        }),
      ])?.truncated,
    ).toBe(true);
    expect(
      parseConstitution([rowWith({ constitution: record() })])?.truncated,
    ).toBe(false);
  });

  it("fills the collections the views read when the payload omits them", () => {
    const parsed = parseConstitution([
      rowWith({
        constitution: { schema_version: 1, stages: [stage("intake")] },
      }),
    ]);

    expect(parsed?.middlewares).toEqual([]);
    expect(parsed?.tools.mounted).toEqual([]);
    expect(parsed?.tools.deferred_count).toBe(0);
    expect(parsed?.tool_authorization.removed).toEqual([]);
    expect(parsed?.skills.available_count).toBe(0);
    expect(parsed?.model.name).toBeNull();
  });
});

describe("splitStages", () => {
  it("keeps the five canonical stages on the ring, in ring order", () => {
    const { ring, outside } = splitStages([
      stage("epilogue"),
      stage("tools"),
      stage("intake"),
      stage("model"),
      stage("context"),
    ]);

    expect(ring.map((entry) => entry.key)).toEqual([
      "intake",
      "context",
      "model",
      "tools",
      "epilogue",
    ]);
    expect(outside).toEqual([]);
  });

  it("sends extension and unrecognized keys to the out-of-ring band", () => {
    const { ring, outside } = splitStages([
      stage("intake"),
      stage("extension", { loop: false }),
      stage("something_new", { loop: false }),
    ]);

    expect(ring.map((entry) => entry.key)).toEqual(["intake"]);
    expect(outside.map((entry) => entry.key)).toEqual([
      "extension",
      "something_new",
    ]);
  });
});
