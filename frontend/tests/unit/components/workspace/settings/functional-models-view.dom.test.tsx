/**
 * The provider dimension's *display* rules in the RAG functional-model view
 * (spec 2026-09-14 rag model provider adaptation §4.5).
 *
 * Two rules are load-bearing and are what these tests pin:
 *
 * 1. An endpoint input appears only for a provider that has **no built-in default** — a
 *    DashScope deployment must not be shown an address field it cannot use.
 * 2. The sparse-source select is always present: it is the field that decides whether a
 *    dense-only provider is usable at all, so hiding it would recreate the trap it closes.
 *
 * The display is driven by the *seeded* config, so each case renders the view once with a
 * different stored provider instead of driving the Radix dropdown — that keeps the test
 * about the rule rather than about Radix's portal behavior.
 */

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { FunctionalModelsView } from "@/components/workspace/settings/functional-models-view";
import type { RagConfigValues, RagConfigView } from "@/core/rag/types";

const hooks = rs.hoisted(() => ({ view: null as RagConfigView | null }));

/** Every label resolves to its own key, so an assertion can name the i18n key directly. */
const KEYS = new Proxy({}, { get: (_target, key) => String(key) });

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

afterEach(() => {
  hooks.view = null;
  cleanup();
});

describe("provider rows", () => {
  it("hides the endpoints a DashScope provider already defaults, and always shows the sparse source", () => {
    renderWith({ embedding_provider: "dashscope", rerank_provider: "dashscope" });

    expect(labelCount("embeddingBaseUrl")).toBe(0);
    expect(labelCount("rerankBaseUrl")).toBe(0);
    // The field that decides whether a dense-only provider is usable is never hidden.
    expect(labelCount("embeddingSparseSource")).toBeGreaterThan(0);
  });

  it("shows an endpoint once the selected provider has no built-in default", () => {
    renderWith({
      embedding_provider: "openai-compatible",
      rerank_provider: "generic-rerank",
    });

    expect(labelCount("embeddingBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("rerankBaseUrl")).toBeGreaterThan(0);
  });

  it("keeps the MinerU token while parsing stays on the cloud API", () => {
    renderWith({ parse_provider: "mineru-cloud" });

    expect(labelCount("mineruToken")).toBeGreaterThan(0);
    expect(labelCount("parseBaseUrl")).toBe(0);
    expect(labelCount("parseBackend")).toBe(0);
  });

  it("swaps the token for the service address when parsing goes local", () => {
    renderWith({ parse_provider: "mineru-local" });

    expect(labelCount("mineruToken")).toBe(0);
    expect(labelCount("parseBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("parseBackend")).toBeGreaterThan(0);
  });
});
