/**
 * 设置 → 模型 的「功能模型」视图（spec 2026-09-10 rag functional-model config §5，plan Task 4 seam C dom）：
 * - 「模型」分区内视图切换（对话模型 / 功能模型），功能模型表单渲染出各角色的字段；
 * - 已存密钥以掩码回显；未改动 → 保存禁用（空 payload 会把整个 rag_config.json 清空）；
 * - 改动 embedding 模型出现「需重建索引」告警；
 * - 保存 payload 只带「文件已拥有字段带出 + 本次改动」（哨兵保留已存密钥）；
 * - 403 → 拒绝态。
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import {
  formValuesFromConfig,
  sparseProbeKey,
  sparseServiceProbeKey,
} from "@/core/rag/config-form";
import type { RagConfigView } from "@/core/rag/types";

const ragHooksMock = rs.hoisted(() => ({
  useRagConfig: rs.fn(),
  useSaveRagConfig: rs.fn(),
  useProbeSparseCapability: rs.fn(),
  useProbeSparseService: rs.fn(),
}));
const modelHooksMock = rs.hoisted(() => ({
  useModels: rs.fn(),
  useModelsConfig: rs.fn(),
  useSaveModelsConfig: rs.fn(),
}));
const knowledgeHooksMock = rs.hoisted(() => ({
  useKnowledgeBases: rs.fn(),
  useReindexStatus: rs.fn(),
  useReindexKnowledgeBase: rs.fn(),
}));
rs.mock("@/core/rag/hooks", () => ragHooksMock);
rs.mock("@/core/models/hooks", () => modelHooksMock);
rs.mock("@/core/knowledge/hooks", () => knowledgeHooksMock);
rs.mock("sonner", () => ({
  toast: { success: rs.fn(), error: rs.fn(), info: rs.fn(), warning: rs.fn() },
}));

const { RagConfigRequestError } = await import("@/core/rag/api");
const { ModelsSettingsPage } = await import(
  "@/components/workspace/settings/models-settings-page"
);

const M = zhCN.settings.models;
const F = zhCN.settings.functionalModels;
const MASKED = "********";
const SPARSE_URL = "http://127.0.0.1:8081";

/** What the server says when it saved the configuration but could not verify it (server-side copy). */
const SAVE_WARNING =
  "提交后的配置已保存，但未能验证：未能连通（EmbedderError）：All connection attempts failed";

/**
 * 重建文案（spec 2026-09-24 §4.3 表）。逐字抄在用例里而不是引用字典：重建现在换的是四类向量
 * （切片 / 实体 / 百科条目 / 人工卡片），源文件与图谱抽取都不重跑，句子必须说全。
 */
const REINDEX_HINT_ZH =
  "换嵌入 provider / 维度后，已有向量全部失效——用这里的入口重新嵌入：切片、实体、百科条目与人工卡片一起换到新的向量空间。只读库中现有文本，不重解析源文件、不重跑图谱抽取。";
const REINDEX_CONFIRM_ZH =
  "将重新嵌入该知识库的全部向量（切片、实体、百科条目、人工卡片；不重解析源文件），期间检索结果可能不稳。目标知识库：";
const REINDEX_HINT_EN =
  "Changing the embedding provider or dimension invalidates every stored vector — re-embed them here: chunks, entities, wiki entries and manual cards all move to the new vector space. This reads the library's existing text and never re-parses source files or re-runs graph extraction.";
const REINDEX_CONFIRM_EN =
  "Every vector in this library will be re-embedded — chunks, entities, wiki entries and manual cards (source files are not re-parsed) — and retrieval may be unstable while it runs. Target library:";

const saveMock = rs.fn();
const reindexMock = rs.fn();
const probeMock = rs.fn();
const sparseServiceProbeMock = rs.fn();

/** What the embedding allowlist reports: who can supply the sparse half, and who fixes its own address. */
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

/** The rerank allowlist's own block: the same rule, its own shape — no `emits_sparse` there. */
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
  // TEI fixes no address either (spec 2026-09-24 §4.3). The row matters even though it renders
  // like the fallback: with it, "editable" means the capability block said so, not "unknown
  // provider ⇒ don't take the field away".
  {
    provider_id: "tei-rerank",
    has_fixed_endpoint: false,
    default_endpoint: null,
  },
];

function view(
  over: Partial<RagConfigView["config"]> = {},
  opts: {
    providers?: typeof EMBEDDING_PROVIDERS | null;
    /** Per-field provenance this case needs to restate (e.g. a key that comes from the env). */
    sources?: Record<string, string>;
    /** The save-time probe's verdict (spec 2026-09-17 save-time probe §3 D3). */
    warning?: string | null;
  } = {},
): RagConfigView {
  return {
    // The probe always reports *something*: `null` means it verified the configuration.
    warning: opts.warning ?? null,
    // `null` models a response from a server that predates the capability block — both blocks
    // ship together, so the opt-out drops both (spec 2026-09-17 alignment §3 D3).
    ...(opts.providers === null
      ? {}
      : {
          embedding_providers: opts.providers ?? EMBEDDING_PROVIDERS,
          rerank_providers: RERANK_PROVIDERS,
        }),
    config: {
      qdrant_url: "http://qdrant:6333",
      embedding_model: "qwen3.7-text-embedding",
      embedding_api_key: MASKED,
      rerank_model: "qwen3-rerank",
      rerank_api_key: "",
      vlm_model: "vl-model",
      vlm_base_url: "https://api.siliconflow.cn/v1",
      vlm_api_key: "",
      extract_model: "deepseek-chat",
      judge_model: "deepseek-chat",
      mineru_api_token: MASKED,
      video: { asr_provider: "funasr", asr_model: "paraformer-zh", caption_model: "" },
      ...over,
    },
    sources: {
      qdrant_url: "config_file",
      embedding_model: "config_file",
      embedding_api_key: "ui",
      rerank_model: "config_file",
      rerank_api_key: "env",
      vlm_model: "config_file",
      vlm_base_url: "config_file",
      vlm_api_key: "unset",
      extract_model: "config_file",
      judge_model: "config_file",
      mineru_api_token: "ui",
      // A deployment that has not configured a sparse service has no sparse key anywhere. Stated
      // explicitly: the probes read "unset" to mean "there is nothing to send".
      sparse_api_key: "unset",
      "video.asr_provider": "config_file",
      "video.asr_model": "config_file",
      "video.caption_model": "config_file",
      ...opts.sources,
    },
  };
}

function setRag(
  over: Partial<RagConfigView["config"]> = {},
  opts: {
    loading?: boolean;
    error?: unknown;
    providers?: typeof EMBEDDING_PROVIDERS | null;
    sources?: Record<string, string>;
  } = {},
) {
  ragHooksMock.useRagConfig.mockReturnValue({
    view: opts.loading
      ? undefined
      : view(over, { providers: opts.providers, sources: opts.sources }),
    isLoading: opts.loading ?? false,
    error: opts.error ?? null,
  });
  ragHooksMock.useSaveRagConfig.mockReturnValue({ mutate: saveMock, isPending: false });
  setProbe();
  setSparseServiceProbe();
  setKnowledge();
}

/**
 * The sparse-service probe's stub. Like the capability probe, a verdict only counts for the values
 * it was taken for, so the key is computed the way the view computes it.
 */
function setSparseServiceProbe(
  over: {
    status?: "ok" | "empty" | "unreachable";
    pending?: boolean;
    /** Set to `false` to hand back a verdict taken for other values. */
    keyForCurrentValues?: boolean;
  } = {},
) {
  sparseServiceProbeMock.mockReset();
  const current = formValuesFromConfig(
    view({
      embedding_sparse_source: "external",
      sparse_provider: "tei-sparse",
      sparse_base_url: SPARSE_URL,
    }),
  );
  const stale = formValuesFromConfig(
    view({
      embedding_sparse_source: "external",
      sparse_provider: "tei-sparse",
      sparse_base_url: "http://127.0.0.1:9999",
    }),
  );
  ragHooksMock.useProbeSparseService.mockReturnValue({
    mutate: sparseServiceProbeMock,
    data:
      over.status === undefined
        ? undefined
        : {
            key: sparseServiceProbeKey(
              over.keyForCurrentValues === false ? stale : current,
              false,
            ),
            status: over.status,
          },
    isPending: over.pending ?? false,
  });
}

/**
 * The probe's own stub. Its verdict is bound to the values it was taken for, so the key is
 * computed the same way the view computes it — otherwise "the conclusion belongs to these
 * values" would be asserted against a key the test made up.
 */
function setProbe(
  over: {
    status?: "supported" | "unsupported" | "unverifiable";
    /** Defaults to the key of an untouched dashscope / qwen3.7-text-embedding form. */
    key?: string;
    pending?: boolean;
  } = {},
) {
  probeMock.mockReset();
  ragHooksMock.useProbeSparseCapability.mockReturnValue({
    mutate: probeMock,
    data:
      over.status === undefined
        ? undefined
        : {
            key:
              over.key ??
              sparseProbeKey(
                formValuesFromConfig(
                  view({
                    embedding_provider: "dashscope",
                    embedding_sparse_source: "provider",
                  }),
                ),
              ),
            status: over.status,
            detail: "",
          },
    isPending: over.pending ?? false,
  });
}

/** 重建入口的默认桩：一个库、空闲、未在提交。 */
function setKnowledge(over: { libraries?: Array<{ id: string; name: string }>; status?: unknown; pending?: boolean } = {}) {
  knowledgeHooksMock.useKnowledgeBases.mockReturnValue({
    data: over.libraries ?? [{ id: "kb-1", name: "产品资料" }],
    isLoading: false,
    error: null,
  });
  knowledgeHooksMock.useReindexStatus.mockReturnValue({ data: over.status });
  knowledgeHooksMock.useReindexKnowledgeBase.mockReturnValue({
    mutate: reindexMock,
    isPending: over.pending ?? false,
  });
}

/**
 * Make the next save resolve with the server's verdict: the view's `onSuccess` receives the
 * response body, so this is how a save that *could not be verified* is staged.
 */
function saveWillReturn(warning: string | null) {
  saveMock.mockImplementation(
    (
      _payload: unknown,
      options: { onSuccess?: (saved: RagConfigView) => void },
    ) => options.onSuccess?.(view({}, { warning })),
  );
}

const VL_MODEL = {
  name: "vl-model",
  model: "Qwen/Qwen3-VL-30B",
  display_name: "Qwen3 VL",
  supports_vision: true,
  api_key: "********",
  source: "ui",
  editable: true,
};
const TEXT_MODEL = {
  name: "text-model",
  model: "deepseek-chat",
  display_name: "DeepSeek Chat",
  supports_vision: false,
  api_key: "********",
  source: "ui",
  editable: true,
};
const ANTHROPIC_MODEL = {
  name: "claude-model",
  model: "claude-x",
  display_name: "Claude X",
  supports_vision: true,
  provider: "anthropic",
  api_key: "********",
  source: "ui",
  editable: true,
};

function renderPage(
  models: Array<Record<string, unknown>> = [VL_MODEL, TEXT_MODEL],
) {
  modelHooksMock.useModels.mockReturnValue({
    models: [
      { id: "deepseek-chat", name: "deepseek-chat", model: "deepseek-chat", display_name: "DeepSeek Chat" },
      { id: "qwen-max", name: "qwen-max", model: "qwen-max", display_name: "Qwen Max" },
    ],
    tokenUsageEnabled: false,
    isLoading: false,
    error: null,
  });
  modelHooksMock.useModelsConfig.mockReturnValue({
    config: { models },
    isLoading: false,
    error: null,
  });
  modelHooksMock.useSaveModelsConfig.mockReturnValue({ mutate: rs.fn(), isPending: false });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <ModelsSettingsPage />
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
}

/** Switch the Models section to its functional-model view. */
function openFunctionalView() {
  fireEvent.click(screen.getByRole("radio", { name: M.viewFunctionalModels }));
}

beforeEach(() => {
  saveMock.mockReset();
  reindexMock.mockReset();
  setRag();
});

afterEach(() => {
  cleanup();
});

describe("Models section view switch", () => {
  it("offers both views and shows the chat list by default", () => {
    renderPage();

    expect(screen.getByRole("radio", { name: M.viewChatModels })).toBeTruthy();
    expect(screen.getByRole("radio", { name: M.viewFunctionalModels })).toBeTruthy();
    expect(screen.queryByText(F.extractModel)).toBeNull();

    openFunctionalView();

    expect(screen.getByText(F.extractModel)).toBeTruthy();
    // The role heading is the wide-layout one; below `lg` each value cell also carries the
    // role name as its stacking line head (spec 2026-09-24 §3.2), so pin the heading itself.
    expect(
      screen.getByText(F.embeddingModel, { selector: ".text-sm.font-semibold" }),
    ).toBeTruthy();
  });
});

describe("functional-model form", () => {
  it("shows an effective value and masks a stored key", () => {
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.embeddingModel)).toHaveProperty(
      "value",
      "qwen3.7-text-embedding",
    );
    expect(screen.getByLabelText(F.embeddingApiKey)).toHaveProperty("value", MASKED);
    expect(screen.getByLabelText(F.rerankApiKey)).toHaveProperty("value", "");
    expect(screen.getByText(F.secretFromEnvBadge)).toBeTruthy();
  });

  it("uses the configured chat models for the extraction picker", () => {
    renderPage();
    openFunctionalView();

    // The picker is a Radix Select (its open/close is unreliable under happy-dom), so the
    // trigger carries the resolved model name; the option list itself is pinned by
    // extractionModelOptions in the node suite.
    expect(screen.getByLabelText(F.extractModel).textContent).toContain("DeepSeek Chat");
  });

  it("keeps Save disabled until something changes", () => {
    renderPage();
    openFunctionalView();

    const save = screen.getByRole("button", { name: zhCN.common.save });
    expect(save).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "qwen3.7-text-embedding-v2" },
    });
    expect(screen.getByRole("button", { name: zhCN.common.save })).toHaveProperty("disabled", false);
  });

  it("warns about re-indexing only after the embedding model changes", () => {
    renderPage();
    openFunctionalView();

    expect(screen.queryByText(F.embeddingChangeWarning)).toBeNull();

    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "qwen3.7-text-embedding-v2" },
    });
    expect(screen.getByText(F.embeddingChangeWarning)).toBeTruthy();
  });

  it("submits the carried-forward file fields plus this edit", async () => {
    renderPage();
    openFunctionalView();

    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]?.[0]).toEqual({
      rerank_model: "qwen3-rerank-v2",
      // The file already owns these two secrets: re-submitted as sentinels so they survive.
      embedding_api_key: MASKED,
      mineru_api_token: MASKED,
      // The provider selects have no empty state — their ids come from the backend allowlist —
      // so an untouched row submits the *effective* default explicitly (config-form.test.ts
      // pins that; 2026-09-14 provider dimension).
      embedding_provider: "dashscope",
      embedding_sparse_source: "provider",
      rerank_provider: "dashscope",
      parse_provider: "mineru-cloud",
    });
  });

  it("shows the denial state for a non-admin", () => {
    setRag({}, { error: new RagConfigRequestError(403, "forbidden") });
    renderPage();
    openFunctionalView();

    expect(screen.getByText(M.adminRequired)).toBeTruthy();
    expect(screen.queryByLabelText(F.embeddingModel)).toBeNull();
  });
});

/**
 * The save-time probe's verdict (spec 2026-09-17 save-time probe §3 D3). A 400 is the ordinary
 * failure path and already reaches the user as a toast; what has no other home is the *successful*
 * save the server could not verify — it must not read as a clean save, and it must not read as a
 * refusal either.
 */
describe("save-time verification notice", () => {
  it("shows what the server could not verify about the configuration it saved", async () => {
    renderPage();
    openFunctionalView();
    saveWillReturn(SAVE_WARNING);

    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    const notice = await screen.findByText(SAVE_WARNING);
    // Saved, with a caveat — the write went through, so the notice is a status and not an alert.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(notice.getAttribute("role")).toBe("status");
  });

  it("says nothing once the server verified a save", async () => {
    renderPage();
    openFunctionalView();
    saveWillReturn(SAVE_WARNING);

    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));
    await screen.findByText(SAVE_WARNING);

    // The notice belongs to the save it describes; the next save reports its own verdict.
    saveWillReturn(null);
    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v3" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhCN.common.save }));

    await waitFor(() => expect(screen.queryByText(SAVE_WARNING)).toBeNull());
  });
});

describe("functional-model layout", () => {
  it("groups the fields under described sections", () => {
    renderPage();
    openFunctionalView();

    for (const title of [
      F.groupRetrieval,
      F.groupExtraction,
      F.groupMultimodal,
      F.groupEvaluation,
      F.groupServices,
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByLabelText(F.groupRetrievalHint)).toBeTruthy();
    expect(screen.getByLabelText(F.groupMultimodalHint)).toBeTruthy();
    expect(screen.getByLabelText(F.groupEvaluationHint)).toBeTruthy();
    expect(screen.getByLabelText(F.groupServicesHint)).toBeTruthy();
  });

  it("labels a provider-fixed endpoint as locked instead of hiding it", () => {
    renderPage();
    openFunctionalView();

    // Both rows ship a vendor address now, and a locked row prints *where it will call* instead of
    // the reason it is locked (spec 2026-09-17 alignment §3 D4) — the reason copy only appears
    // where there is nothing to show, which is how the parse rows still use it.
    expect(screen.getAllByText("https://dashscope.aliyuncs.com").length).toBe(
      2,
    );
    expect(screen.queryAllByText(F.lockedByProvider).length).toBe(0);
    expect(screen.queryByLabelText(F.embeddingBaseUrl)).toBeNull();
    expect(screen.queryByLabelText(F.rerankBaseUrl)).toBeNull();
  });

  it("picks a configured chat model as the eval judge", () => {
    renderPage();
    openFunctionalView();

    // Radix Select cannot be opened reliably under happy-dom; the trigger carries the
    // resolved label and the option list itself is pinned by modelReferenceOptions.
    expect(screen.getByLabelText(F.judgeModel).textContent).toContain("DeepSeek Chat");
  });

  it("writes the retrieval pair's row labels once, not once per column", () => {
    renderPage();
    openFunctionalView();

    // The two roles share one label gutter (2026-09-15): each of the pair's four rows is
    // labelled a single time **in the wide layout** — below `lg` every value cell carries its
    // own copy of the label as a stacking line head (spec 2026-09-24 §3.2), hidden above `lg`.
    // Scoped to the retrieval card: 「模型」 is also the section's own title.
    const card = screen
      .getByText(F.groupRetrieval)
      .closest<HTMLElement>('[data-slot="card"]')!;
    const counts = [
      F.providerLabel,
      F.modelLabel,
      F.apiKeyLabel,
      F.endpointLabel,
    ].map((shared) => [
      shared,
      within(card)
        .getAllByText(shared)
        .filter((el) => !el.closest(".md\\:hidden")).length,
    ]);
    expect(Object.fromEntries(counts)).toEqual({
      [F.providerLabel]: 1,
      [F.modelLabel]: 1,
      [F.apiKeyLabel]: 1,
      [F.endpointLabel]: 1,
    });
    expect(screen.getByLabelText(F.embeddingApiKey)).toBeTruthy();
    expect(screen.getByLabelText(F.rerankApiKey)).toBeTruthy();
  });

  it("puts the provenance chip inside the credential field, not beside it", () => {
    renderPage();
    openFunctionalView();

    // The fixture backs the rerank key from the environment, so that row carries the chip.
    const input = screen.getByLabelText(F.rerankApiKey);
    const chip = screen.getByText(F.secretFromEnvBadge);

    // One wrapper holds both, so the chip spends the field's own padding instead of the
    // row's width — the retrieval pair has two fields on that row (2026-09-16).
    expect(input.parentElement).toBe(chip.parentElement);
    expect(input.className).toContain("pl-32");
    // It is a label on the field, never a click target: the caret must still land on the input.
    expect(chip.className).toContain("pointer-events-none");
  });

  it("treats the chip as a placeholder: it clears the moment the field is yours", () => {
    renderPage();
    openFunctionalView();

    const input = screen.getByLabelText(F.rerankApiKey);
    expect(screen.getByText(F.secretFromEnvBadge)).toBeTruthy();
    expect(input.className).toContain("pl-32");

    // Focusing already means "this field is mine": the caret must not start after the note.
    fireEvent.focus(input);
    expect(screen.queryByText(F.secretFromEnvBadge)).toBeNull();
    expect(input.className).not.toContain("pl-32");

    // Left empty again, the note is back — it is state, not a one-shot hint.
    fireEvent.blur(input);
    expect(screen.getByText(F.secretFromEnvBadge)).toBeTruthy();

    // And once something is typed it stays away on blur: the override is what the field holds,
    // so the note must never re-appear in front of it (2026-09-16).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sk-mine" } });
    fireEvent.blur(input);
    expect(screen.queryByText(F.secretFromEnvBadge)).toBeNull();
  });

  it("paints a credential chip and a locked row's reason identically", () => {
    renderPage();
    openFunctionalView();

    // Two cells that both say "you do not type this here", so they read the same: same size,
    // same tint, and both lead their field. They used to differ in all three (2026-09-16).
    // Re-pointed at the parse rows: both endpoint rows now print an address instead of the
    // reason (spec 2026-09-17 alignment §3 D4), while these still say *why* they are locked
    // (the field belongs to the other parse mode).
    const chip = screen.getByText(F.secretFromEnvBadge);
    const reason = screen.getAllByText(F.lockedLocalOnly)[0]!;

    for (const element of [chip, reason]) {
      expect(element.className).toContain("text-sm");
      expect(element.className).toContain("text-muted-foreground/70");
    }
    expect(chip.className).toContain("left-3");
  });

  it("labels every input, including the ones that used to be bare boxes", () => {
    renderPage();
    openFunctionalView();

    for (const label of [F.apiKeyLabel, F.asrModel, F.qdrantUrl, F.mineruToken]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText(F.embeddingApiKey)).toBeTruthy();
    expect(screen.getByLabelText(F.asrModel)).toBeTruthy();
  });

  it("picks the caption model from the configured entries, asking for no endpoint or key", () => {
    renderPage();
    openFunctionalView();

    const captionRow = screen.getByLabelText(F.captionModel).closest("div");

    expect(screen.getByLabelText(F.captionModel).textContent).toContain("Qwen3 VL");
    // The endpoint and the key come from that entry, so the row has no inputs at all.
    expect(captionRow?.querySelector("input")).toBeNull();
    expect(screen.getByLabelText(F.captionModelHint)).toBeTruthy();
  });

  it("does not claim an Anthropic entry can never serve this leg", () => {
    // The old sentence is what made the picker hide those entries; both locales drop it.
    expect(F.captionModelHint).not.toContain("Anthropic 条目无法用于这条腿");
    expect(enUS.settings.functionalModels.captionModelHint).not.toContain(
      "Anthropic entry can never serve this leg",
    );
    // Anchors, so deleting the sentence would fail too: the row still says where the
    // endpoint and key come from, and that the protocol follows the entry.
    expect(F.captionModelHint).toContain("接口地址与 API Key");
    expect(F.captionModelHint).toContain("Anthropic");
    expect(enUS.settings.functionalModels.captionModelHint).toContain(
      "endpoint and API key",
    );
    expect(enUS.settings.functionalModels.captionModelHint).toContain(
      "Anthropic",
    );
  });

  it("stops warning about a missing vision model when an Anthropic entry can serve the leg", () => {
    renderPage([ANTHROPIC_MODEL, TEXT_MODEL]);
    openFunctionalView();

    // The old filter left this picker with no vision-capable entry at all, and the row said so.
    expect(screen.queryByText(F.vlmNoVisionModel)).toBeNull();
  });

  it("still warns when no entry declares vision support", () => {
    renderPage([TEXT_MODEL]);
    openFunctionalView();

    expect(screen.getByText(F.vlmNoVisionModel)).toBeTruthy();
  });

  it("keeps a stored caption model that names no configured entry", () => {
    setRag({ vlm_model: "qwen3.7-flash-legacy" });
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.captionModel).textContent).toContain(
      "qwen3.7-flash-legacy",
    );
  });
});

/**
 * 嵌入地址那一行（spec 2026-09-17 §3 D1/D5/D6）：**判据来自能力块**（谁自带地址谁锁），
 * 锁框里显示**实际会用的地址**；存量值仍然生效（百炼的 workspace 级地址就靠这一条活着），
 * 但当它偏离提供方默认时，旁边要给一个「恢复默认」把它清掉——否则那个部署会看着一个
 * 改不掉的框，而请求实际打在残留地址上。
 */
describe("embedding address row", () => {
  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: zhCN.common.save });
  const resetButton = () =>
    screen.queryByRole("button", { name: F.resetToDefault });

  it("offers the Ark dialect and saves it without a dense-only complaint", () => {
    setRag({
      embedding_provider: "volcengine-ark",
      embedding_sparse_source: "provider",
    });
    renderPage();
    openFunctionalView();

    // It emits both halves, so the "dense only" refusal must not fire for it.
    expect(screen.queryByRole("alert")).toBeNull();
    // An ordinary edit still has to unlock Save — proof the rule is not just "nothing changed".
    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "doubao-embedding-vision-250615" },
    });
    expect(saveButton().disabled).toBe(false);
  });

  it("locks the address for a provider that fixes its own endpoint", () => {
    setRag({ embedding_provider: "volcengine-ark" });
    renderPage();
    openFunctionalView();

    expect(screen.getByText("https://ark.cn-beijing.volces.com")).toBeTruthy();
    expect(screen.queryByLabelText(F.embeddingBaseUrl)).toBeNull();
    // No stored address ⇒ nothing to reset.
    expect(resetButton()).toBeNull();
  });

  it("leaves a provider without a fixed endpoint editable", () => {
    setRag({
      embedding_provider: "openai-compatible",
      embedding_base_url: "http://127.0.0.1:8080/v1",
    });
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.embeddingBaseUrl)).toBeTruthy();
    expect(resetButton()).toBeNull();
  });

  it("shows a stored override and lets the admin drop it", () => {
    setRag({
      embedding_provider: "volcengine-ark",
      embedding_base_url: "https://ws-example.cn-beijing.maas.aliyuncs.com",
    });
    renderPage();
    openFunctionalView();

    expect(
      screen.getByText("https://ws-example.cn-beijing.maas.aliyuncs.com"),
    ).toBeTruthy();
    fireEvent.click(resetButton()!);

    // The box falls back to the vendor's own address, and the action has nothing left to do.
    expect(screen.getByText("https://ark.cn-beijing.volces.com")).toBeTruthy();
    expect(resetButton()).toBeNull();
  });
});

/**
 * 重排地址那一行与嵌入那行**同构**（spec 2026-09-17 alignment §3 D4）：判据同样来自能力块，
 * 只是读重排自己那块（条目形状不同：那边没有 `emits_sparse`）。存量 `rerank_base_url` 在运行期
 * 同样优先（`build_reranker` 只在有值时才把它传给实现），所以同样要给「恢复默认」。
 */
describe("rerank address row", () => {
  const resetButton = () =>
    screen.queryByRole("button", { name: F.resetToDefault });

  it("locks the row and shows the vendor's own address", () => {
    setRag({ rerank_provider: "dashscope" });
    renderPage();
    openFunctionalView();

    // 两行都是同一个默认端点，所以这句话出现两次；重排行没有输入框、也没有可清的东西。
    expect(screen.getAllByText("https://dashscope.aliyuncs.com").length).toBe(
      2,
    );
    expect(screen.queryByLabelText(F.rerankBaseUrl)).toBeNull();
    expect(resetButton()).toBeNull();
  });

  it("leaves the row editable for a provider that brings its own address", () => {
    setRag({
      rerank_provider: "generic-rerank",
      rerank_base_url: "http://localhost:8000",
    });
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.rerankBaseUrl)).toBeTruthy();
    expect(resetButton()).toBeNull();
  });

  it("shows a stored rerank override and lets the admin drop it", () => {
    setRag({
      rerank_provider: "dashscope",
      rerank_base_url: "http://127.0.0.1:9999",
    });
    renderPage();
    openFunctionalView();

    expect(screen.getByText("http://127.0.0.1:9999")).toBeTruthy();
    fireEvent.click(resetButton()!);

    // 存量值被清掉了 ⇒ 框里回到提供方的默认地址，动作也没有可做的事。
    expect(screen.queryByText("http://127.0.0.1:9999")).toBeNull();
    expect(screen.getAllByText("https://dashscope.aliyuncs.com").length).toBe(
      2,
    );
    expect(resetButton()).toBeNull();
  });

  it("stays editable when the server sends no rerank capability block", () => {
    // `unknown ≠ cannot`：旧的网关答不了这个问题，就不要替它把框锁上。
    setRag({ rerank_provider: "dashscope" }, { providers: null });
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.rerankBaseUrl)).toBeTruthy();
  });
});

/**
 * 重排的第三种形状 TEI（spec 2026-09-24 §4.3）：下拉多一格，端点行照旧按能力块判；模型行
 * 不加任何条件提示（同日已裁——请求里不带 model 字段这件事由既有 `sparseModelHint` 先例覆盖）。
 */
describe("TEI rerank provider", () => {
  it("offers the TEI shape as a third rerank provider", async () => {
    renderPage();
    openFunctionalView();

    fireEvent.click(screen.getByRole("combobox", { name: F.rerankProvider }));

    // 三项，顺序即形状的次序；「通用重排」的标签同时瘦身——TEI 不再算进它的形状里。
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "阿里百炼 (DashScope)",
      "通用重排 (Cohere / Jina 形状)",
      "TEI 重排",
    ]);
    expect(enUS.settings.functionalModels.providerTeiRerank).toBe("TEI rerank");
    expect(enUS.settings.functionalModels.providerGenericRerank).toBe(
      "Generic rerank (Cohere / Jina shape)",
    );
  });

  it("keeps the address row editable for a stored TEI provider", () => {
    // 存量的 `tei-rerank` 要活过载入归一（`asEnum` 与渲染共用同一个选项常量，spec §4.3 ⚠️）：
    // 漏加一格就会被静默读成 dashscope，端点行随即锁死、存量地址再也改不动。
    setRag({ rerank_provider: "tei-rerank" });
    renderPage();
    openFunctionalView();

    expect(screen.getByLabelText(F.rerankBaseUrl)).toBeTruthy();
    expect(screen.getByLabelText(F.rerankModel)).toBeTruthy();
  });
});

/**
 * 稀疏来源与所选嵌入提供商的能力不匹配（spec 2026-09-16 §3 D2）：编辑期就地拦下，
 * 而不是等第一次入库/检索时后端拒绝。文案与后端那句同一事实，且 Save 旁也要给出原因——
 * 只灰按钮不给理由，告警落在视口外的人会卡在「能改不能存、不知道为什么」。
 */
describe("sparse source vs provider capability", () => {
  const unsupported = () =>
    setRag({
      embedding_provider: "openai-compatible",
      embedding_sparse_source: "provider",
    });
  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: zhCN.common.save });

  it("refuses a dense-only provider that is asked for the sparse half", () => {
    unsupported();
    renderPage();
    openFunctionalView();

    expect(screen.getByRole("alert").textContent).toBe(
      F.sparseProviderUnsupported,
    );
    // An ordinary edit would normally make Save clickable; this pair has to keep it blocked,
    // which is what makes the assertion below about the rule and not about "nothing changed".
    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "bge-m3" },
    });
    expect(saveButton().disabled).toBe(true);
    // The same sentence rides next to the button it blocks.
    expect(saveButton().parentElement?.textContent).toContain(
      F.sparseProviderUnsupported,
    );
  });

  it("lets the save through once the sparse source no longer needs the provider", () => {
    setRag({
      embedding_provider: "openai-compatible",
      embedding_sparse_source: "bm25",
    });
    renderPage();
    openFunctionalView();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(true); // nothing edited yet — the usual rule
    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "bge-m3" },
    });
    expect(saveButton().disabled).toBe(false);
  });

  it("stays quiet when the server reports no capabilities at all", () => {
    setRag(
      {
        embedding_provider: "openai-compatible",
        embedding_sparse_source: "provider",
      },
      { providers: null },
    );
    renderPage();
    openFunctionalView();

    // An older server cannot answer the question, so it must not be answered for it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "bge-m3" },
    });
    expect(saveButton().disabled).toBe(false);
  });
});

/**
 * 模型级能力探测（spec 2026-09-16 §3 D2/D4）：名单说得清「provider 这个方言支不支持」，
 * 说不清「这个具体模型支不支持」——于是选中后就打一次真实调用（只读、不落盘），
 * 三态里只有 `unsupported` 拦人；`unverifiable` 放行并标「未验证」，因为"没查成"不是"不支持"。
 */
describe("sparse capability probe", () => {
  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: zhCN.common.save });
  /** An edit that would otherwise unlock Save without touching what the probe was asked about. */
  const editUnrelated = () =>
    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
  const editModel = () =>
    fireEvent.change(screen.getByLabelText(F.embeddingModel), {
      target: { value: "bge-m3" },
    });
  /** The advanced disclosure is closed — and unmounted — until it is opened. */
  const openAdvanced = () =>
    fireEvent.click(screen.getByRole("button", { name: /^高级设置/ }));

  it("blocks a model the probe proved cannot supply the sparse half", () => {
    setProbe({ status: "unsupported" });
    renderPage();
    openFunctionalView();

    expect(screen.getByRole("alert").textContent).toBe(
      F.sparseProviderUnsupported,
    );
    // An ordinary edit would normally make Save clickable; this verdict has to keep it blocked,
    // which is what makes the assertion below about the rule and not about "nothing changed".
    editUnrelated();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().parentElement?.textContent).toContain(
      F.sparseProviderUnsupported,
    );
  });

  it("drops that verdict the moment the model it was taken for changes", () => {
    setProbe({ status: "unsupported" });
    renderPage();
    openFunctionalView();

    expect(screen.getByRole("alert").textContent).toBe(
      F.sparseProviderUnsupported,
    );
    // A different model is a different question: answering it with the old verdict would let a
    // just-refused candidate through (or refuse one nobody has checked).
    editModel();
    expect(screen.queryByText(F.sparseProviderUnsupported)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("keeps the admin's own choice of sparse source untouched", () => {
    setProbe({ status: "unsupported" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    // Not silently rewritten to an easier value: showing one thing and sending another is
    // worse than the refusal, and the admin loses the right to know what was chosen.
    expect(
      screen.getByLabelText(F.embeddingSparseSource).textContent,
    ).toContain(F.sparseSourceProvider);
  });

  it("lets an unverifiable model through, marked as unverified", () => {
    setProbe({ status: "unverifiable" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.getByText(F.sparseUnverified)).toBeTruthy();
    // Same slot as 检测中, so the row keeps its height when the verdict lands.
    expect(
      screen
        .getByText(F.sparseUnverified)
        .closest('[data-slot="select-trigger"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    editUnrelated();
    expect(saveButton().disabled).toBe(false);
  });

  it("says nothing extra when the probe confirmed the model", () => {
    setProbe({ status: "supported" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.queryByText(F.sparseUnverified)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    editUnrelated();
    expect(saveButton().disabled).toBe(false);
  });

  it("shows the probe as in flight while it is running", () => {
    setProbe({ pending: true });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.getByText(F.sparseProbing)).toBeTruthy();
    // Nothing is claimed while the answer is unknown — and nothing is blocked either.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the probe mark inside the field, so the row never grows", () => {
    setProbe({ pending: true });
    renderPage();
    openFunctionalView();
    openAdvanced();

    const mark = screen.getByText(F.sparseProbing);
    // The trigger is a fixed-height box, so a mark that rides in it cannot push the rows below it
    // down and back — which is what a line of its own did, on every open and every model edit.
    expect(mark.closest('[data-slot="select-trigger"]')).not.toBeNull();
    // …and it is a *sibling* of the value slot, never inside it: Radix mirrors the selected item's
    // text into the trigger, so anything placed in the value would be copied into the options.
    expect(mark.closest('[data-slot="select-value"]')).toBeNull();
  });

  it("does not ask the server until the question can be asked at all", async () => {
    setRag({
      embedding_provider: "dashscope",
      embedding_sparse_source: "provider",
      embedding_model: "",
    });
    renderPage();
    openFunctionalView();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("does not ask when the sparse half is coming from somewhere else", async () => {
    setRag({
      embedding_provider: "dashscope",
      embedding_sparse_source: "bm25",
    });
    renderPage();
    openFunctionalView();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("asks even though the key arrives from the environment", async () => {
    // The deployed shape: a stored-or-environment key comes back as an empty input box with
    // `sources[key] === "env"`. Reading "the box is empty" as "no key" would make the whole
    // feature dead precisely where it is needed.
    setRag(
      {
        embedding_provider: "dashscope",
        embedding_sparse_source: "provider",
        embedding_api_key: "",
      },
      { sources: { embedding_api_key: "env" } },
    );
    renderPage();
    openFunctionalView();

    expect(
      screen.getByLabelText<HTMLInputElement>(F.embeddingApiKey).value,
    ).toBe("");
    await waitFor(() => expect(probeMock).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(probeMock.mock.calls[0]?.[0]).toMatchObject({
      embedding_provider: "dashscope",
      embedding_model: "qwen3.7-text-embedding",
    });
  });
});

/**
 * 「稀疏模型」这一行的交代（spec 2026-09-16 §3 D6）：值会落盘，但**从不发给服务**——TEI 一个
 * 实例只服务一个模型，所以请求里没有 model 字段。本期只补说明、不改行为（字段照存、下发照旧）。
 */
describe("sparse model disclosure", () => {
  it("says the sparse model is stored but never sent", () => {
    setRag({ embedding_sparse_source: "external" });
    renderPage();
    openFunctionalView();
    fireEvent.click(screen.getByRole("button", { name: /^高级设置/ }));

    expect(screen.getByLabelText(F.sparseModelHint)).toBeTruthy();
    // The sentence has to name the reason, not merely exist: "does this field do anything?" is the
    // question the row raises, and one TEI instance serving one model is the answer.
    expect(F.sparseModelHint).toContain("TEI");
    expect(F.sparseModelHint).toContain("一个实例只服务一个模型");
  });
});

/**
 * 外部稀疏服务的连通性探针（spec 2026-09-16 connectivity §3 D4）：地址填错 / 服务没起这类问题
 * 过去要等入库才暴露，现在在编辑期就报。**只报不拦**——服务可能稍后才起，把"暂时连不上"升格成
 * "不许保存"就是 `unverifiable` 那条教训的重演。
 */
describe("sparse service connectivity", () => {
  const withExternal = (over: Record<string, unknown> = {}) =>
    setRag({
      embedding_sparse_source: "external",
      sparse_provider: "tei-sparse",
      sparse_base_url: SPARSE_URL,
      ...over,
    });
  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: zhCN.common.save });
  /** The advanced disclosure is closed — and unmounted — until it is opened. */
  const openAdvanced = () =>
    fireEvent.click(screen.getByRole("button", { name: /^高级设置/ }));

  it("asks the service once the address is there", async () => {
    withExternal();
    renderPage();
    openFunctionalView();
    openAdvanced();

    await waitFor(() => expect(sparseServiceProbeMock).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(sparseServiceProbeMock.mock.calls[0]?.[0]).toMatchObject({
      sparse_provider: "tei-sparse",
      sparse_base_url: SPARSE_URL,
    });
  });

  it("does not ask at all without an address to reach", async () => {
    withExternal({ sparse_base_url: "" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sparseServiceProbeMock).not.toHaveBeenCalled();
  });

  it("does not ask while the sparse half comes from somewhere else", async () => {
    setRag({ embedding_sparse_source: "bm25" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sparseServiceProbeMock).not.toHaveBeenCalled();
  });

  it("warns that the service is unreachable, and still lets the admin save", () => {
    // The stub has to come *after* the config stub: seeding the view re-registers it.
    withExternal();
    setSparseServiceProbe({ status: "unreachable" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    // The address row says so in place…
    expect(screen.getByText(F.sparseServiceUnreachable)).toBeTruthy();
    // …and the save is *not* blocked: the service may come up in a minute.
    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    expect(saveButton().disabled).toBe(false);
  });

  it("warns differently when the service answers with no terms at all", () => {
    withExternal();
    setSparseServiceProbe({ status: "empty" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    // Reachable but useless is a different problem from unreachable: the admin should look at the
    // model it loaded, not at the network.
    expect(screen.getByText(F.sparseServiceEmpty)).toBeTruthy();
    expect(screen.queryByText(F.sparseServiceUnreachable)).toBeNull();
  });

  it("says nothing when the service answered with terms", () => {
    withExternal();
    setSparseServiceProbe({ status: "ok" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.queryByText(F.sparseServiceUnreachable)).toBeNull();
    expect(screen.queryByText(F.sparseServiceEmpty)).toBeNull();
  });

  it("drops a verdict taken for another address", () => {
    withExternal();
    setSparseServiceProbe({
      status: "unreachable",
      keyForCurrentValues: false,
    });
    renderPage();
    openFunctionalView();
    openAdvanced();

    // Editing the address asks a new question; answering it with the old verdict would report a
    // service that was never called.
    expect(screen.queryByText(F.sparseServiceUnreachable)).toBeNull();
  });

  it("keeps the mark inside the address field", () => {
    withExternal();
    setSparseServiceProbe({ status: "unreachable" });
    renderPage();
    openFunctionalView();
    openAdvanced();

    const mark = screen.getByText(F.sparseServiceUnreachable);
    expect(mark.closest('[data-slot="sparse-service-status"]')).not.toBeNull();
  });
});

/**
 * 「独立稀疏服务」但没挑提供商（2026-09-17 补）：这一对后端**必定拒绝**，而界面上原来既不提示、
 * 也能保存——要等那一次 400 才知道。现在与 dense-only 那条走同一套表现：告警 + Save 旁同一句 +
 * Save 禁用；同时把那个空选项的措辞从"（由服务决定）"（那是解析档位那行的语义）改成「（未选择）」。
 */
describe("sparse service with no provider chosen", () => {
  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: zhCN.common.save });
  const openAdvanced = () =>
    fireEvent.click(screen.getByRole("button", { name: /^高级设置/ }));

  it("says so while editing, and keeps Save blocked", () => {
    // The wire says "not declared" with null; the form widens it to "" for Radix.
    setRag({ embedding_sparse_source: "external", sparse_provider: null });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.getByRole("alert").textContent).toBe(
      F.sparseServiceUnconfigured,
    );
    // An ordinary edit would normally unlock Save; this pair has to keep it blocked.
    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().parentElement?.textContent).toContain(
      F.sparseServiceUnconfigured,
    );
  });

  it("lets the save through once a provider is chosen", () => {
    setRag({
      embedding_sparse_source: "external",
      sparse_provider: "tei-sparse",
      sparse_base_url: SPARSE_URL,
    });
    renderPage();
    openFunctionalView();
    openAdvanced();

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText(F.rerankModel), {
      target: { value: "qwen3-rerank-v2" },
    });
    expect(saveButton().disabled).toBe(false);
  });

  it("calls the empty option what it is, not what the parse row means", () => {
    // The wire says "not declared" with null; the form widens it to "" for Radix.
    setRag({ embedding_sparse_source: "external", sparse_provider: null });
    renderPage();
    openFunctionalView();
    openAdvanced();

    // The label is only reachable inside the listbox (Radix does not open in happy-dom), so pin it
    // through the trigger's mirrored value — which is where the misleading wording used to show.
    expect(screen.getByLabelText(F.sparseProvider).textContent).toContain(
      F.sparseProviderNone,
    );
  });
});

/**
 * 重建入口（spec 2026-09-14 §5 / P4）：设置页本身没有知识库身份，所以目标库由这一行
 * 选出来，再经确认弹窗点名——重建会把目标库的全部切片重新嵌入，点错代价高。
 */
describe("rebuild entry", () => {
  it("keeps the action disabled until a library is chosen", () => {
    renderPage();
    openFunctionalView();

    const action = screen.getByRole<HTMLButtonElement>("button", {
      name: F.reindexAction,
    });
    expect(action.disabled).toBe(true);
    // 目标未定时不撒谎：连「上次重建完成」这类历史结论也不必显示（这里本来就没有）
    expect(screen.queryByText(F.reindexLastFailed)).toBeNull();
  });

  it("says there is nothing to rebuild when the user owns no library", () => {
    setRag();
    setKnowledge({ libraries: [] });
    renderPage();
    openFunctionalView();

    expect(screen.getByText(F.reindexNoKb)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: F.reindexAction }).disabled).toBe(true);
  });

  it("renders live counters while a rebuild runs and disables the action", () => {
    setRag();
    setKnowledge({
      status: {
        in_progress: true,
        last_run: null,
        progress: {
          documents_total: 7,
          documents_done: 3,
          chunks_indexed: 42,
          // 三键自 run 起手就存在于线上（后端恒发），0 = 还没走到那三遍。
          entities_indexed: 0,
          wiki_entries_indexed: 0,
          cards_indexed: 0,
        },
      },
    });
    renderPage();
    openFunctionalView();

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("3/7");
    expect(status.textContent).toContain("42");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: F.reindexAction }).disabled).toBe(true);
  });

  it("counts every vector collection in the running line", () => {
    setRag();
    setKnowledge({
      status: {
        in_progress: true,
        last_run: null,
        progress: {
          documents_total: 3,
          documents_done: 3,
          chunks_indexed: 100,
          entities_indexed: 20,
          wiki_entries_indexed: 7,
          cards_indexed: 1,
        },
      },
    });
    renderPage();
    openFunctionalView();

    // 四类向量之和（spec 2026-09-24 §5.4 / §4.3）：重建换的是切片 + 实体 + 百科条目 +
    // 人工卡片；只报 chunks_indexed 会把另外三遍的成果藏起来——而它们正是跨空间坏掉的那批。
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("3/3");
    expect(status.textContent).toContain("已写入向量 128");
  });

  it("spells out that a rebuild moves every vector collection", () => {
    renderPage();
    openFunctionalView();

    // ⓘ 的可及名就是那句话本身，所以钉住它等于同时钉住"文案对"与"它真的挂在页面上"。
    expect(screen.getByLabelText(REINDEX_HINT_ZH)).toBeTruthy();
    // 确认句与 en 两侧没有 DOM 可钉（本套件只渲染 zh-CN），逐字对字典。
    expect(F.reindexConfirmDescription).toBe(REINDEX_CONFIRM_ZH);
    expect(enUS.settings.functionalModels.reindexHint).toBe(REINDEX_HINT_EN);
    expect(enUS.settings.functionalModels.reindexConfirmDescription).toBe(
      REINDEX_CONFIRM_EN,
    );
  });

  it("reports the previous run's verdict when idle", () => {
    setRag();
    setKnowledge({ status: { in_progress: false, last_run: "failed", progress: null } });
    renderPage();
    openFunctionalView();

    expect(screen.getByRole("alert").textContent).toContain(F.reindexLastFailed);
  });
});

/** 确认弹窗单独测：不驱动 Radix，直接渲染它自己的契约（点名目标 + 确认/禁用）。 */
describe("ReindexDialog", () => {
  it("names the target library and confirms", async () => {
    const { ReindexDialog } = await import(
      "@/components/workspace/settings/reindex-dialog"
    );
    const onConfirm = rs.fn();
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <ReindexDialog
          open
          onOpenChange={() => undefined}
          kbName="产品资料"
          onConfirm={onConfirm}
          pending={false}
        />
      </I18nContext.Provider>,
    );

    // 目标必须点名：设置页没有库身份，确认框是最后一道「点错库」的防线
    expect(screen.getByText(F.reindexConfirmTitle)).toBeTruthy();
    expect(screen.getByText("产品资料")).toBeTruthy();
    // 范围也要点名（spec 2026-09-24 §4.3）：换的是四类向量，不只是切片。
    expect(screen.getByText(REINDEX_CONFIRM_ZH)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: F.reindexConfirmAction }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks a second confirm while the request is in flight", async () => {
    const { ReindexDialog } = await import(
      "@/components/workspace/settings/reindex-dialog"
    );
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <ReindexDialog
          open
          onOpenChange={() => undefined}
          kbName="产品资料"
          onConfirm={rs.fn()}
          pending
        />
      </I18nContext.Provider>,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: F.reindexConfirmAction,
      }).disabled,
    ).toBe(true);
  });
});
