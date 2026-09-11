import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConstitutionDeveloperView } from "@/components/workspace/constitution/constitution-developer-view";
import type {
  ConstitutionRecord,
  GateNotification,
} from "@/core/constitution/types";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

/**
 * The developer tier.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.2.
 * Unlike the user tier this one is supposed to show the real names, so the
 * assertions here are about the shape of that detail: rows grouped by stage
 * (unrecognized stages included, in the out-of-ring band), the two derived axes
 * rendered as data rather than prose, the hooks list, and the gate `changes`
 * shown as the keys they arrived under — no renaming, because those keys are
 * contract fields and a mapping table would become a third vocabulary.
 */
const T = zhCN.constitution;

afterEach(cleanup);

const stage = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  loop: ["context", "model", "tools"].includes(key),
  members: 1,
  gates: 0,
  handoff_gates: 0,
  ...overrides,
});

const record = (
  overrides: Partial<ConstitutionRecord> = {},
): ConstitutionRecord => ({
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
    stage("context"),
    stage("model"),
    stage("tools"),
    stage("epilogue"),
  ],
  middlewares: [
    {
      name: "ToolProgressMiddleware",
      stage: "tools",
      kind: "overlay",
      hooks: ["wrap_tool_call"],
      frequency: "per_model_call",
      overlay_kind: "guard",
    },
    {
      name: "ThreadDataMiddleware",
      stage: "intake",
      kind: "member",
      hooks: ["before_agent"],
      frequency: "once_per_run",
    },
    {
      name: "SomeCustomMiddleware",
      stage: "something_new",
      kind: "member",
      hooks: ["before_model"],
      frequency: "per_model_call",
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
  tool_authorization: { removed: ["dangerous_tool"], removed_count: 1 },
  skills: {
    available_count: 8,
    deferred_discovery: false,
    describe_skill_bound: false,
  },
  mcp_routing_built: true,
  truncated: false,
  ...overrides,
});

const gate: GateNotification = {
  tag: "read_gate",
  name: "ReadBeforeWriteMiddleware",
  hook: "wrap_tool_call",
  action: "block",
  changes: {
    tool_name: "write_file",
    tool_call_id: "call_abc",
    path: "/mnt/user-data/workspace/notes.md",
    reason: "no_current_read_mark",
  },
};

function renderView(
  props: Partial<Parameters<typeof ConstitutionDeveloperView>[0]> = {},
) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <ConstitutionDeveloperView
        record={record()}
        gates={[]}
        selectedKey={null}
        onSelectStage={() => undefined}
        {...props}
      />
    </I18nContext.Provider>,
  );
}

describe("ConstitutionDeveloperView", () => {
  it("shows the assembled facts", () => {
    renderView();

    expect(screen.getByTestId("constitution-fact-model").textContent).toContain(
      "qwen3.8-flash",
    );
    expect(screen.getByTestId("constitution-fact-tools").textContent).toContain(
      "1",
    );
    expect(
      screen.getByTestId("constitution-fact-removed").textContent,
    ).toContain("1");
  });

  it("only mentions truncation when something was cut", () => {
    const { unmount } = renderView();
    expect(screen.queryByTestId("constitution-truncated")).toBeNull();
    unmount();

    renderView({ record: record({ truncated: true }) });
    expect(screen.getByTestId("constitution-truncated").textContent).toBe(
      T.truncated,
    );
  });

  it("groups rows by stage, with unrecognized stages in the out-of-ring band", () => {
    renderView();

    expect(
      screen.getByTestId("constitution-devmw-group-intake").textContent,
    ).toContain("ThreadDataMiddleware");
    expect(
      screen.getByTestId("constitution-devmw-group-tools").textContent,
    ).toContain("ToolProgressMiddleware");
    // Not one of the five canonical stages, so it lands in the band.
    expect(
      screen.getByTestId("constitution-devmw-group-something_new").textContent,
    ).toContain("SomeCustomMiddleware");
    // A canonical stage with no rows draws no group.
    expect(screen.queryByTestId("constitution-devmw-group-model")).toBeNull();
  });

  it("renders the two axes as data and the hooks on demand", () => {
    renderView();

    const row = screen.getByTestId(
      "constitution-devmw-row-ToolProgressMiddleware",
    );
    expect(row.textContent).toContain(zhCN.constitution.kind.gate);
    expect(row.textContent).toContain(
      zhCN.constitution.frequency.per_model_call,
    );

    // Collapsed: the hook list is not there yet.
    expect(
      screen.queryByTestId("constitution-devmw-hooks-ToolProgressMiddleware"),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId("constitution-devmw-toggle-ToolProgressMiddleware"),
    );
    expect(
      screen.getByTestId("constitution-devmw-hooks-ToolProgressMiddleware")
        .textContent,
    ).toContain("wrap_tool_call");
  });

  it("spells out what a middleware does", async () => {
    renderView();

    // The row button is the trigger, so focusing it opens the same description
    // a pointer would reveal.
    fireEvent.focus(
      screen.getByTestId("constitution-devmw-toggle-ToolProgressMiddleware"),
    );

    const tooltips = await screen.findAllByRole("tooltip");
    expect(tooltips.map((node) => node.textContent)).toContain(
      T.middleware.ToolProgressMiddleware,
    );
  });

  it("shows the changes a gate reported under their own keys", () => {
    renderView({ gates: [gate] });

    const notice = screen.getByTestId("constitution-dev-gate-0");
    expect(notice.textContent).toContain("write_file");
    expect(notice.textContent).toContain("/mnt/user-data/workspace/notes.md");
    // Raw contract keys, never renamed.
    expect(
      screen.getByTestId("constitution-dev-gate-change-0-tool_call_id")
        .textContent,
    ).toContain("call_abc");
    expect(
      screen.getByTestId("constitution-dev-gate-change-0-reason").textContent,
    ).toContain("no_current_read_mark");
  });
});
