/**
 * The provider dimension's *display* rules in the RAG functional-model view
 * (spec 2026-09-14 rag model provider adaptation §4.5, revised 2026-09-15).
 *
 * Two rules are load-bearing and are what these tests pin:
 *
 * 1. Every provider-driven row is **present**; a row the current provider fixes is shown
 *    **locked** with its reason instead of disappearing. A control that vanishes on a
 *    provider switch reads as a missing feature, and the tall cells used to push the two
 *    retrieval columns out of alignment.
 * 2. The sparse settings live behind the advanced disclosure, and its four dependent rows
 *    follow rule 1: unlocked together when the source is `external`, locked together otherwise.
 *
 * The display is driven by the *seeded* config, so each case renders the view once with a
 * different stored provider instead of driving the Radix dropdown — that keeps the test
 * about the rule rather than about Radix's portal behavior.
 */

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FunctionalModelsView } from "@/components/workspace/settings/functional-models-view";
import type { RagConfigValues, RagConfigView } from "@/core/rag/types";

const hooks = rs.hoisted(() => ({ view: null as RagConfigView | null }));

/**
 * Every label resolves to its own key, so an assertion can name the i18n key directly. The
 * two count-taking keys answer as functions (a plain string would throw when called).
 */
const KEYS = new Proxy({} as Record<string, unknown>, {
  get: (_target, key) =>
    key === "advancedSettings" || key === "subsetSelected"
      ? (count: number) => `${String(key)}(${count})`
      : String(key),
});

rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: { common: KEYS, settings: { models: KEYS, functionalModels: KEYS } },
  }),
}));

rs.mock("@/core/rag/hooks", () => ({
  useRagConfig: () => ({ view: hooks.view, isLoading: false, error: null }),
  useSaveRagConfig: () => ({ isPending: false, mutate: rs.fn() }),
}));

rs.mock("@/core/models/hooks", () => ({
  useModels: () => ({ models: [] }),
  useModelsConfig: () => ({ config: { models: [] } }),
}));

// The rebuild entry is library-scoped and its hooks poll; these display-rule cases only
// need the row to render, so the entry stays inert (no library, idle, nothing pending).
rs.mock("@/core/knowledge/hooks", () => ({
  useKnowledgeBases: () => ({ data: [], isLoading: false, error: null }),
  useReindexStatus: () => ({ data: undefined }),
  useReindexKnowledgeBase: () => ({ mutate: rs.fn(), isPending: false }),
}));

rs.mock("sonner", () => ({
  toast: { success: rs.fn(), info: rs.fn() },
}));

/** The file owns nothing, so every value below is the effective config.yaml / env one. */
function renderWith(config: Partial<RagConfigValues>) {
  hooks.view = { config: { video: null, ...config }, sources: {} } as RagConfigView;
  return render(<FunctionalModelsView />);
}

const labelCount = (label: string) => screen.queryAllByLabelText(label).length;

/** Mirrors the `KEYS` proxy's shape for the count-taking keys (`advancedSettings(5)`). */
const advancedLabel = (count: number) => `advancedSettings(${count})`;

/** The advanced disclosure is closed by default; its rows only exist once it opens. */
function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: advancedLabel(5) }));
}

afterEach(() => {
  hooks.view = null;
  cleanup();
});

describe("provider rows", () => {
  it("shows a provider-fixed endpoint locked, with the sparse rows behind the advanced disclosure", () => {
    renderWith({ embedding_provider: "dashscope", rerank_provider: "dashscope" });

    // Locked, not hidden: no endpoint input, and the reason is on screen.
    expect(labelCount("embeddingBaseUrl")).toBe(0);
    expect(labelCount("rerankBaseUrl")).toBe(0);
    expect(screen.getAllByText("lockedByProvider").length).toBe(2);

    // Sparse settings defer to the disclosure, and start locked (source = provider).
    expect(labelCount("embeddingSparseSource")).toBe(0);
    openAdvanced();
    expect(labelCount("embeddingSparseSource")).toBeGreaterThan(0);
    expect(screen.getAllByText("lockedExternalOnly").length).toBe(4);
  });

  it("unlocks the endpoint once the selected provider has no built-in default", () => {
    renderWith({
      embedding_provider: "openai-compatible",
      rerank_provider: "generic-rerank",
    });

    expect(labelCount("embeddingBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("rerankBaseUrl")).toBeGreaterThan(0);
    // No locked endpoint row remains once both providers need an address.
    expect(screen.queryByText("lockedByProvider")).toBeNull();
  });

  it("unlocks the sparse rows when the source is a separate service", () => {
    renderWith({ embedding_sparse_source: "external" });
    openAdvanced();

    expect(labelCount("sparseBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("sparseModel")).toBeGreaterThan(0);
    expect(labelCount("sparseApiKey")).toBeGreaterThan(0);
    expect(screen.queryByText("lockedExternalOnly")).toBeNull();
  });

  it("asks the sparse service the same four questions as the embedding one", () => {
    renderWith({ embedding_sparse_source: "external" });
    openAdvanced();

    // Nested under 稀疏向量来源 and named exactly like the retrieval pair, in the same order.
    // 「稀疏」 used to be repeated on every row to say what the indent now says (2026-09-16).
    const panel = document.querySelector('[data-slot="collapsible-content"]')!;
    const rows = Array.from(panel.firstElementChild!.children).map((row) =>
      row.firstElementChild?.textContent?.trim(),
    );
    expect(rows).toEqual([
      "embeddingSparseSource",
      "providerLabel",
      "modelLabel",
      "apiKeyLabel",
      "endpointLabel",
    ]);

    // The visible names are shared, so the controls carry their own to stay distinguishable.
    for (const field of [
      "sparseProvider",
      "sparseModel",
      "sparseApiKey",
      "sparseBaseUrl",
    ]) {
      expect(labelCount(field)).toBeGreaterThan(0);
    }
  });

  it("keeps the MinerU token while parsing stays on the cloud API", () => {
    renderWith({ parse_provider: "mineru-cloud" });
    openAdvanced();

    expect(labelCount("mineruToken")).toBeGreaterThan(0);
    // The local-service rows are shown locked: "local service only".
    expect(labelCount("parseBaseUrl")).toBe(0);
    expect(labelCount("parseBackend")).toBe(0);
    expect(screen.getAllByText("lockedLocalOnly").length).toBe(2);
  });

  it("swaps the token for the service address when parsing goes local", () => {
    renderWith({ parse_provider: "mineru-local" });
    openAdvanced();

    expect(labelCount("mineruToken")).toBe(0);
    expect(labelCount("parseBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("parseBackend")).toBeGreaterThan(0);
    expect(screen.getByText("lockedCloudOnly")).toBeTruthy();
  });
});
