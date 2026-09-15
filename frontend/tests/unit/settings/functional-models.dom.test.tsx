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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { RagConfigView } from "@/core/rag/types";

const ragHooksMock = rs.hoisted(() => ({
  useRagConfig: rs.fn(),
  useSaveRagConfig: rs.fn(),
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

function view(over: Partial<RagConfigView["config"]> = {}): RagConfigView {
  return {
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
    },
  };
}

function setRag(over: Partial<RagConfigView["config"]> = {}, opts: { loading?: boolean; error?: unknown } = {}) {
  ragHooksMock.useRagConfig.mockReturnValue({
    view: opts.loading ? undefined : view(over),
    isLoading: opts.loading ?? false,
    error: opts.error ?? null,
  });
  ragHooksMock.useSaveRagConfig.mockReturnValue({ mutate: saveMock, isPending: false });
  setKnowledge();
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
    expect(screen.getByText(F.secretFromEnv)).toBeTruthy();
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
    expect(screen.getByText(F.groupRetrievalHint)).toBeTruthy();
    expect(screen.getByText(F.groupMultimodalHint)).toBeTruthy();
    expect(screen.getByText(F.groupEvaluationHint)).toBeTruthy();
    expect(screen.getByText(F.groupServicesHint)).toBeTruthy();
  });

  it("says the retrieval endpoint is fixed by the client", () => {
    renderPage();
    openFunctionalView();

    expect(screen.getByText(F.retrievalEndpointHint)).toBeTruthy();
  });

  it("picks a configured chat model as the eval judge", () => {
    renderPage();
    openFunctionalView();

    // Radix Select cannot be opened reliably under happy-dom; the trigger carries the
    // resolved label and the option list itself is pinned by modelReferenceOptions.
    expect(screen.getByLabelText(F.judgeModel).textContent).toContain("DeepSeek Chat");
  });

  it("labels every input, including the ones that used to be bare boxes", () => {
    renderPage();
    openFunctionalView();

    for (const label of [F.embeddingApiKey, F.rerankApiKey, F.asrModel, F.qdrantUrl, F.mineruToken]) {
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
    expect(screen.getByText(F.captionModelHint)).toBeTruthy();
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
