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
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { formValuesFromConfig, sparseProbeKey } from "@/core/rag/config-form";
import type { RagConfigView } from "@/core/rag/types";

const ragHooksMock = rs.hoisted(() => ({
  useRagConfig: rs.fn(),
  useSaveRagConfig: rs.fn(),
  useProbeSparseCapability: rs.fn(),
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

const saveMock = rs.fn();
const reindexMock = rs.fn();
const probeMock = rs.fn();

/** What the embedding allowlist reports: only dashscope can supply the sparse half itself. */
const EMBEDDING_PROVIDERS = [
  { provider_id: "dashscope", emits_sparse: true },
  { provider_id: "openai-compatible", emits_sparse: false },
];

function view(
  over: Partial<RagConfigView["config"]> = {},
  opts: {
    providers?: typeof EMBEDDING_PROVIDERS | null;
    /** Per-field provenance this case needs to restate (e.g. a key that comes from the env). */
    sources?: Record<string, string>;
  } = {},
): RagConfigView {
  return {
    // `null` models a response from a server that predates the capability block.
    ...(opts.providers === null
      ? {}
      : { embedding_providers: opts.providers ?? EMBEDDING_PROVIDERS }),
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
  setKnowledge();
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

function renderPage() {
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
    config: {
      models: [
        {
          name: "vl-model",
          model: "Qwen/Qwen3-VL-30B",
          display_name: "Qwen3 VL",
          supports_vision: true,
          api_key: "********",
          source: "ui",
          editable: true,
        },
        {
          name: "text-model",
          model: "deepseek-chat",
          display_name: "DeepSeek Chat",
          supports_vision: false,
          api_key: "********",
          source: "ui",
          editable: true,
        },
      ],
    },
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
    expect(screen.getByText(F.embeddingModel)).toBeTruthy();
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

    // DashScope ships its own address: the rows stay visible, say why, and carry no input.
    expect(screen.getAllByText(F.lockedByProvider).length).toBe(2);
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
    // labelled a single time, while the credentials keep their per-column accessible names.
    // Scoped to the retrieval card: 「模型」 is also the section's own title.
    const card = screen
      .getByText(F.groupRetrieval)
      .closest<HTMLElement>('[data-slot="card"]')!;
    const counts = [
      F.providerLabel,
      F.modelLabel,
      F.apiKeyLabel,
      F.endpointLabel,
    ].map((shared) => [shared, within(card).getAllByText(shared).length]);
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
    const chip = screen.getByText(F.secretFromEnvBadge);
    const reason = screen.getAllByText(F.lockedByProvider)[0]!;

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
      status: { in_progress: true, last_run: null, progress: { documents_total: 7, documents_done: 3, chunks_indexed: 42 } },
    });
    renderPage();
    openFunctionalView();

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("3/7");
    expect(status.textContent).toContain("42");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: F.reindexAction }).disabled).toBe(true);
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
