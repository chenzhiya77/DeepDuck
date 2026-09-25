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
  // The capability probe only decorates the sparse-source row; these display-rule cases
  // never reach it, so it stays idle (no verdict, nothing in flight).
  useProbeSparseCapability: () => ({
    isPending: false,
    data: undefined,
    mutate: rs.fn(),
  }),
  // The sparse-service probe only decorates the address row; these display-rule cases never reach
  // it, so it stays idle too.
  useProbeSparseService: () => ({
    isPending: false,
    data: undefined,
    mutate: rs.fn(),
  }),
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

/**
 * What the embedding allowlist reports: which dialects fix their own endpoint (so the address
 * row is read-only) and where they point. Mirrors the real response — the view decides the row
 * from *this*, not from a provider name (spec 2026-09-17 §3 D1).
 */
const EMBEDDING_PROVIDERS = [
  {
    provider_id: "dashscope",
    emits_sparse: true,
    has_fixed_endpoint: true,
    default_endpoint: "https://dashscope.aliyuncs.com",
  },
  {
    provider_id: "volcengine-ark",
    emits_sparse: true,
    has_fixed_endpoint: true,
    default_endpoint: "https://ark.cn-beijing.volces.com",
  },
  {
    provider_id: "openai-compatible",
    emits_sparse: false,
    has_fixed_endpoint: false,
    default_endpoint: null,
  },
];

/** The rerank leg's own block: same rule as above, its own shape (no `emits_sparse` there). */
const RERANK_PROVIDERS = [
  {
    provider_id: "dashscope",
    has_fixed_endpoint: true,
    default_endpoint: "https://dashscope.aliyuncs.com",
  },
  {
    provider_id: "generic-rerank",
    has_fixed_endpoint: false,
    default_endpoint: null,
  },
];

/** The file owns nothing, so every value below is the effective config.yaml / env one. */
function renderWith(config: Partial<RagConfigValues>) {
  hooks.view = {
    config: { video: null, ...config },
    sources: {},
    embedding_providers: EMBEDDING_PROVIDERS,
    rerank_providers: RERANK_PROVIDERS,
  } as RagConfigView;
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

    // Locked, not hidden: no endpoint input, and each row says *where it will call* — the vendor's
    // own address for both rows now (spec 2026-09-17 alignment §3 D4), so the reason copy is not
    // printed anywhere on these two rows.
    expect(labelCount("embeddingBaseUrl")).toBe(0);
    expect(labelCount("rerankBaseUrl")).toBe(0);
    expect(screen.getAllByText("https://dashscope.aliyuncs.com").length).toBe(
      2,
    );
    expect(screen.queryAllByText("lockedByProvider").length).toBe(0);

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

  it("explains why the sparse model is asked for but never sent", () => {
    renderWith({ embedding_sparse_source: "external" });
    openAdvanced();

    // The value is stored in `rag_config.json` but never reaches the service: TEI serves one model
    // per instance, so no model field is sent at all (deerflow/knowledge/sparse.py). The row owes
    // the admin that sentence — an input whose effect nobody can explain is worse than no input.
    // Exactly one: the note belongs to this row, and 「稀疏」 is not repeated down the gutter.
    expect(labelCount("sparseModelHint")).toBe(1);
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
    expect(labelCount("parseTier")).toBe(0);
    expect(screen.getAllByText("lockedLocalOnly").length).toBe(2);
  });

  it("swaps the token for the service address when parsing goes local", () => {
    renderWith({ parse_provider: "mineru-local" });
    openAdvanced();

    expect(labelCount("mineruToken")).toBe(0);
    expect(labelCount("parseBaseUrl")).toBeGreaterThan(0);
    expect(labelCount("parseTier")).toBeGreaterThan(0);
    expect(screen.getByText("lockedCloudOnly")).toBeTruthy();
  });
});

/**
 * Shrinkable-row rules (spec 2026-09-24 settings-responsive-layout §4 1-2):
 *
 * 1. Row tracks are `minmax(0,1fr)`, so a squeezed column collapses instead of pushing its
 *    sibling out of the card (a bare `1fr` track floors at the child's min-content width).
 * 2. Every wrapper that sits directly on a row may collapse (`min-w-0`) — the input's own
 *    `min-w-0` cannot save a wrapper that still reports min-content.
 */
describe("shrinkable rows", () => {
  const rowOf = (el: HTMLElement) =>
    el.closest<HTMLElement>('div[class*="grid-cols-[8rem_"]')!;
  const trackCount = (row: HTMLElement) =>
    row.className.match(/minmax\(0,1fr\)/g)?.length ?? 0;

  it("pair rows carry two shrinkable tracks, single rows one", () => {
    renderWith({
      embedding_provider: "openai-compatible",
      rerank_provider: "generic-rerank",
      embedding_sparse_source: "external",
    });

    expect(trackCount(rowOf(screen.getByLabelText("embeddingModel")))).toBe(2);

    openAdvanced();
    expect(trackCount(rowOf(screen.getByLabelText("sparseModel")))).toBe(1);
  });

  it("grid children may collapse: secret wrapper, address wrapper, select triggers", () => {
    renderWith({ embedding_sparse_source: "external" });

    expect(
      screen.getByLabelText("embeddingApiKey").parentElement!.className,
    ).toContain("min-w-0");
    expect(
      screen.getByRole("combobox", { name: "embeddingProvider" }).className,
    ).toContain("min-w-0");

    openAdvanced();
    expect(
      screen.getByLabelText("sparseBaseUrl").parentElement!.className,
    ).toContain("min-w-0");
  });
});

/**
 * Narrow stacking (spec 2026-09-24 settings-responsive-layout §3.2, D1/D2/D3 甲):
 * below `lg` a two-value row stacks two self-describing lines — bold role short name
 * (the wide column heading's own word) + the shared label + the value. The shared gutter
 * label hides there and the role-heading row hides with it. At `lg` and up nothing moves.
 */
describe("narrow stacking", () => {
  const rowOf = (el: HTMLElement) =>
    el.closest<HTMLElement>('div[class*="grid-cols-[8rem_"]')!;

  it("regroups into one role block per column below md", () => {
    renderWith({});

    // The four rows go `contents` so their cells regroup under the block heads via `order`.
    const row = rowOf(screen.getByLabelText("embeddingModel"));
    expect(row.className).toContain("max-md:contents");

    // One bold block head per role (the wide heading's own word), narrow-only.
    for (const role of ["embeddingModel", "rerankModel"] as const) {
      const heads = screen
        .getAllByText(role)
        .filter((el) => el.className.includes("md:hidden"));
      expect(heads.length).toBe(1);
    }

    // Exactly one divider between the two blocks.
    const dividers = document.querySelectorAll<HTMLElement>(
      'div[class*="border-t"][class*="md:hidden"]',
    );
    expect(dividers.length).toBe(1);

    // Each cell's line head is the shared field label only — no role prefix per line.
    const cells = Array.from(row.children).slice(1) as HTMLElement[];
    expect(cells[0]!.className).toContain("order-3");
    expect(cells[1]!.className).toContain("order-9");
    for (const cell of cells) {
      expect(cell.className).toContain("md:contents");
      const copy = cell.firstElementChild as HTMLElement;
      expect(copy.textContent).toBe("modelLabel");
    }
  });

  it("single rows stack label-above-value below md", () => {
    renderWith({ embedding_sparse_source: "external" });
    openAdvanced();

    expect(rowOf(screen.getByLabelText("sparseModel")).className).toContain(
      "max-md:grid-cols-1",
    );
  });

  it("keeps the wide role-heading row hidden below md and drops the English pills", () => {
    renderWith({});

    const heading = screen.getByText("embeddingModel", {
      selector: "span.text-sm.font-semibold",
    });
    expect(heading.parentElement!.className).toContain("max-md:hidden");

    // 乙 (spec §3.2 revision): the pills are gone everywhere, wide included.
    expect(screen.queryByText("roleTagEmbedding")).toBeNull();
    expect(screen.queryByText("roleTagRerank")).toBeNull();
  });
});
