import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConstitutionTrigger } from "@/components/workspace/constitution/constitution-trigger";
import type { ConstitutionRecord } from "@/core/constitution/types";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { updateLocalSettings } from "@/core/settings/store";

/**
 * The header entry point and the dialog behind it.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §12.1/§6.3.
 * Two claims are worth pinning here: the trigger's visibility is the snapshot's
 * existence (a button onto an empty dialog is worse than no button, and this is
 * what spares the tier any empty-state copy), and the two tiers really are two
 * components — the same payload shows middleware names in one and none in the
 * other.
 */
const T = zhCN.constitution;

afterEach(() => {
  cleanup();
  // The tier choice is remembered, so it has to be put back explicitly — the
  // settings store keeps its own in-memory copy and clearing storage would not
  // reach it.
  updateLocalSettings("constitution", { view: "user" });
});

const stage = (key: string) => ({
  key,
  loop: ["context", "model", "tools"].includes(key),
  members: 2,
  gates: 0,
  handoff_gates: 0,
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
  stages: ["intake", "context", "model", "tools", "epilogue"].map(stage),
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
    mounted: [],
    mounted_count: 0,
    deferred_names: [],
    deferred_count: 0,
    auto_promote_top_k: 3,
    truncated: false,
  },
  tool_authorization: { removed: [], removed_count: 0 },
  skills: {
    available_count: 0,
    deferred_discovery: false,
    describe_skill_bound: false,
  },
  mcp_routing_built: false,
  truncated: false,
};

function renderTrigger(recordProp: ConstitutionRecord | null) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      <ConstitutionTrigger record={recordProp} gates={[]} />
    </I18nContext.Provider>,
  );
}

describe("ConstitutionTrigger", () => {
  it("stays out of the header when the run has no snapshot", () => {
    renderTrigger(null);

    expect(screen.queryByTestId("constitution-trigger")).toBeNull();
  });

  it("names itself for assistive tech, having no visible label", () => {
    renderTrigger(record);

    expect(
      screen.getByTestId("constitution-trigger").getAttribute("aria-label"),
    ).toBe(T.title);
  });

  it("opens the user tier first, and can switch to the developer tier", async () => {
    renderTrigger(record);

    // Nothing of the view is mounted before it is asked for.
    expect(screen.queryByTestId("constitution-user-view")).toBeNull();

    fireEvent.click(screen.getByTestId("constitution-trigger"));
    expect(await screen.findByTestId("constitution-user-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("constitution-view-developer"));
    const developer = await screen.findByTestId("constitution-developer-view");
    expect(developer.textContent).toContain("ThreadDataMiddleware");
  });

  it("keeps the two tiers apart: the payload's internals stay out of the user tier", async () => {
    renderTrigger(record);
    fireEvent.click(screen.getByTestId("constitution-trigger"));

    const userView = await screen.findByTestId("constitution-user-view");
    expect(userView.textContent).not.toContain("Middleware");
  });

  it("reopens on the tier the reader last chose", async () => {
    const first = renderTrigger(record);
    fireEvent.click(screen.getByTestId("constitution-trigger"));
    fireEvent.click(await screen.findByTestId("constitution-view-developer"));
    await screen.findByTestId("constitution-developer-view");
    first.unmount();

    renderTrigger(record);
    fireEvent.click(screen.getByTestId("constitution-trigger"));
    expect(
      await screen.findByTestId("constitution-developer-view"),
    ).toBeTruthy();
    expect(screen.queryByTestId("constitution-user-view")).toBeNull();
  });
});
