import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConstitutionUserView } from "@/components/workspace/constitution/constitution-user-view";
import type {
  ConstitutionRecord,
  GateNotification,
} from "@/core/constitution/types";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

/**
 * The end-user tier.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.1.
 * Two things are load-bearing here: the ring plus the gate notices, and the
 * curation projection — this view reads `stages[]` and the gate events and
 * nothing else, so no middleware class name and no tool name can reach it. The
 * second assertion below is the render-layer twin of the backend's
 * `stages[]`-serialization test: that one cannot stop the frontend from reading a
 * real name out of another field and painting it.
 */
const T = zhCN.constitution;

afterEach(cleanup);

const stage = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  loop: ["context", "model", "tools"].includes(key),
  members: 2,
  gates: 0,
  handoff_gates: 0,
  ...overrides,
});

const record: ConstitutionRecord = {
  schema_version: 1,
  model: {
    name: "qwen3.8-flash",
    thinking_enabled: true,
    reasoning_effort: null,
  },
  agent: { name: "rag", is_bootstrap: false },
  checkpoint_mode: "full",
  runtime_flags: {},
  stages: [
    stage("intake"),
    stage("context", { members: 9 }),
    stage("model", { gates: 3 }),
    stage("tools", { gates: 2, handoff_gates: 1 }),
    stage("epilogue"),
  ],
  // Deliberately present: this view must not paint any of these names.
  middlewares: [
    {
      name: "ToolProgressMiddleware",
      stage: "tools",
      kind: "overlay",
      hooks: ["wrap_tool_call"],
      frequency: "per_model_call",
      overlay_kind: "guard",
    },
  ],
  tools: {
    mounted: [{ name: "hybrid_search", source: "tool_group", group: "rag" }],
    mounted_count: 1,
    deferred_names: ["mcp_x__y"],
    deferred_count: 1,
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
  truncated: false,
};

const gate = (tag: GateNotification["tag"]): GateNotification => ({
  tag,
  name: "ToolProgressMiddleware",
  hook: "wrap_tool_call",
  action: "block",
  changes: { tool_name: "hybrid_search" },
});

function renderView(
  overrides: Partial<Parameters<typeof ConstitutionUserView>[0]> = {},
) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <ConstitutionUserView
        stages={record.stages}
        gates={[]}
        selectedKey={null}
        onSelectStage={() => undefined}
        {...overrides}
      />
    </I18nContext.Provider>,
  );
}

describe("ConstitutionUserView", () => {
  it("names the stages a person can act on", () => {
    renderView();

    const text = screen.getByTestId("constitution-user-view").textContent ?? "";
    expect(text).toContain(T.stage.intake);
    expect(text).toContain(T.stage.model);
    expect(text).toContain(T.stage.epilogue);
  });

  it("never paints an internal name, however the payload is shaped", () => {
    // The snapshot carries real middleware and tool names; this tier must not
    // render them. A curated projection, not a filtered one.
    renderView();

    const text = screen.getByTestId("constitution-user-view").textContent ?? "";
    expect(text).not.toContain("Middleware");
    expect(text).not.toContain("hybrid_search");
    expect(text).not.toContain("mcp_x__y");
  });

  it("says what is happening on the selected stage", () => {
    renderView({ selectedKey: "model" });

    expect(screen.getByTestId("constitution-activity").textContent).toBe(
      T.activity.model,
    );
  });

  it("describes the stage under the pointer, and clears when it leaves", () => {
    renderView();

    fireEvent.pointerEnter(screen.getByTestId("constitution-node-tools"));
    expect(screen.getByTestId("constitution-activity").textContent).toBe(
      T.activity.tools,
    );

    fireEvent.pointerLeave(screen.getByTestId("constitution-node-tools"));
    expect(screen.getByTestId("constitution-activity").textContent).toBe("");
  });

  it("keeps the line's space but says nothing before any stage is described", () => {
    // Held open rather than unmounted: appearing and disappearing would shove
    // the notices up and down under the pointer.
    renderView();

    expect(screen.getByTestId("constitution-activity").textContent).toBe("");
  });

  it("reports the gate decisions, newest first and capped", () => {
    renderView({
      gates: [
        gate("read_gate"),
        gate("sandbox_audit"),
        gate("subagent_limit"),
        gate("skill_policy"),
      ],
    });

    const notices = screen.getAllByTestId("constitution-gate-notice");
    expect(notices).toHaveLength(3);
    // Newest first: the last event is at the top, and the oldest is dropped.
    expect(notices[0]?.textContent).toBe(T.gate.skill_policy);
    expect(notices[1]?.textContent).toBe(T.gate.subagent_limit);
    expect(notices[2]?.textContent).toBe(T.gate.sandbox_audit);
    expect(screen.queryByText(T.gate.read_gate)).toBeNull();
  });

  it("reports the stage selection upwards", () => {
    const selected: string[] = [];
    renderView({ onSelectStage: (key) => selected.push(key) });

    fireEvent.click(screen.getByTestId("constitution-node-tools"));
    expect(selected).toEqual(["tools"]);
  });
});
