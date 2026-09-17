/**
 * RAG 功能模型配置的前端纯逻辑（spec 2026-09-10 rag functional-model config §5，plan Task 3 seam C node）：
 * - `formValuesFromConfig`：GET 视图 → 表单初值（已存密钥以哨兵回显）；
 * - `buildRagConfigInput`：表单 → PUT payload。后端是**整对象替换**，故 payload 必须由
 *   「文件已拥有的字段带出 + 本次改动」两部分组成——否则只改一个字段会把文件里其它覆盖值删掉；
 * - `isEmbeddingChange`：换 embedding 模型的判定（驱动「已有知识库需重建索引」告警）；
 * - 客户端：GET/PUT 的 URL/方法/body 与 403 → isAdminRequired 的错误映射。
 *
 * fixture 刻意让「文件默认什么都不拥有」（全部 config_file / env / unset），每条用例自己声明
 * 哪几个字段属于文件（`sources` 里标 `ui`），这样 payload 期望值是可逐条读懂的。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";

const fetchMock = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchMock.fetch }));

const { MASKED_RAG_SECRET, loadRagConfig, RagConfigRequestError, saveRagConfig } =
  await import("@/core/rag/api");
import {
  buildRagConfigInput,
  EMBEDDING_PROVIDER_OPTIONS,
  formValuesFromConfig,
  hasFormChanges,
  isCaptionCapable,
  isEmbeddingChange,
  isSparseProviderOptionDisabled,
  isSparseServiceUnconfigured,
  isSparseSourceUnsupported,
  MODEL_REFERENCE_NONE,
  modelReferenceOptions,
  resolveFixedEndpointRow,
  resolveRerankEndpointRow,
  resolveSparseCapability,
  shouldProbeSparseService,
  sparseProbeKey,
  sparseServiceProbeKey,
  sparseServiceVerdictFor,
  visionReferenceOptions,
} from "@/core/rag/config-form";
import type { RagConfigSource, RagConfigView } from "@/core/rag/types";

/**
 * A view where the file owns nothing: every field is either the operator's (`config_file`),
 * backed by an environment variable, or unset. Each test opts fields into file ownership.
 */
function view(
  over: Partial<RagConfigView["config"]> = {},
  sources: Record<string, RagConfigSource> = {},
): RagConfigView {
  return {
    // The form helpers read nothing but `config` / `sources`; the save-time verdict rides along.
    warning: null,
    config: {
      qdrant_url: "http://qdrant:6333",
      embedding_model: "qwen3.7-text-embedding",
      embedding_api_key: "",
      rerank_model: "qwen3-rerank",
      rerank_api_key: "",
      vlm_model: "Qwen/Qwen3-VL-30B-A3B-Instruct",
      vlm_base_url: "https://api.siliconflow.cn/v1",
      vlm_api_key: "",
      extract_model: "deepseek-chat",
      judge_model: "deepseek-chat",
      mineru_api_token: "",
      embedding_provider: "dashscope",
      embedding_base_url: "",
      embedding_sparse_source: "provider",
      sparse_provider: null,
      sparse_base_url: "",
      sparse_model: "",
      sparse_api_key: "",
      rerank_provider: "dashscope",
      rerank_base_url: "",
      parse_provider: "mineru-cloud",
      parse_base_url: "",
      parse_backend: null,
      video: { asr_provider: "funasr", asr_model: "paraformer-zh", caption_model: "" },
      ...over,
    },
    sources: {
      qdrant_url: "config_file",
      embedding_model: "config_file",
      embedding_api_key: "unset",
      rerank_model: "config_file",
      rerank_api_key: "env",
      vlm_model: "config_file",
      vlm_base_url: "config_file",
      vlm_api_key: "unset",
      extract_model: "config_file",
      judge_model: "config_file",
      mineru_api_token: "unset",
      embedding_provider: "config_file",
      embedding_base_url: "config_file",
      embedding_sparse_source: "config_file",
      sparse_provider: "config_file",
      sparse_base_url: "config_file",
      sparse_model: "config_file",
      sparse_api_key: "unset",
      rerank_provider: "config_file",
      rerank_base_url: "config_file",
      parse_provider: "config_file",
      parse_base_url: "config_file",
      parse_backend: "config_file",
      "video.asr_provider": "config_file",
      "video.asr_model": "config_file",
      "video.caption_model": "config_file",
      ...sources,
    },
  };
}

/** A view whose file owns one stored key. */
function viewWithStoredKey(): RagConfigView {
  return view(
    { embedding_api_key: MASKED_RAG_SECRET },
    { embedding_api_key: "ui" },
  );
}

afterEach(() => {
  fetchMock.fetch.mockReset();
});

describe("formValuesFromConfig", () => {
  it("maps the effective values and keeps a masked secret as-is", () => {
    const values = formValuesFromConfig(viewWithStoredKey());

    expect(values.embedding_model).toBe("qwen3.7-text-embedding");
    expect(values.embedding_api_key).toBe(MASKED_RAG_SECRET);
    expect(values.rerank_api_key).toBe("");
    expect(values.video).toEqual({
      asr_provider: "funasr",
      asr_model: "paraformer-zh",
      caption_model: "",
    });
  });

  it("falls back to empty strings for an unset view", () => {
    const values = formValuesFromConfig({
      config: {},
      sources: {},
      warning: null,
    });

    expect(values.qdrant_url).toBe("");
    expect(values.embedding_api_key).toBe("");
    expect(values.video.asr_provider).toBe("funasr");
  });
});

describe("buildRagConfigInput", () => {
  it("submits nothing when nothing changed and the file owns nothing", () => {
    const current = view();

    expect(buildRagConfigInput(formValuesFromConfig(current), current)).toEqual({});
  });

  it("carries the file's own override forward so a partial edit cannot drop it", () => {
    const current = view({}, { rerank_model: "ui" });
    const values = formValuesFromConfig(current);
    values.extract_model = ""; // operator-owned: clearing it changes nothing

    expect(buildRagConfigInput(values, current)).toEqual({ rerank_model: "qwen3-rerank" });
  });

  it("clears a file-owned field explicitly", () => {
    const current = view({}, { rerank_model: "ui" });
    const values = formValuesFromConfig(current);
    values.rerank_model = "";

    expect(buildRagConfigInput(values, current)).toEqual({ rerank_model: "" });
  });

  it("submits a newly typed value for an operator-owned field", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    values.embedding_model = "qwen3.7-text-embedding-v2";

    expect(buildRagConfigInput(values, current)).toEqual({
      embedding_model: "qwen3.7-text-embedding-v2",
    });
  });

  it("preserves an untouched stored secret with the sentinel", () => {
    const current = viewWithStoredKey();
    const values = formValuesFromConfig(current);
    values.embedding_model = "qwen3.7-text-embedding-v2";

    expect(buildRagConfigInput(values, current)).toEqual({
      embedding_model: "qwen3.7-text-embedding-v2",
      embedding_api_key: MASKED_RAG_SECRET,
    });
  });

  it("clears a stored secret when the input is emptied", () => {
    const current = viewWithStoredKey();
    const values = formValuesFromConfig(current);
    values.embedding_api_key = "";

    expect(buildRagConfigInput(values, current)).toEqual({ embedding_api_key: "" });
  });

  it("submits a rotated secret value", () => {
    const current = viewWithStoredKey();
    const values = formValuesFromConfig(current);
    values.embedding_api_key = "sk-rotated";

    expect(buildRagConfigInput(values, current)).toEqual({ embedding_api_key: "sk-rotated" });
  });

  it("leaves env-backed and unset secrets alone until they are typed into", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    expect(buildRagConfigInput(values, current)).toEqual({});

    values.rerank_api_key = "sk-env-override";
    expect(buildRagConfigInput(values, current)).toEqual({ rerank_api_key: "sk-env-override" });
  });

  it("carries and updates the nested video block", () => {
    const current = view({}, { "video.asr_model": "ui" });
    const values = formValuesFromConfig(current);
    values.video.asr_provider = "whisper";

    expect(buildRagConfigInput(values, current)).toEqual({
      video: { asr_model: "paraformer-zh", asr_provider: "whisper" },
    });
  });

  it("trims what it submits", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    values.vlm_model = "  Qwen/Qwen3-VL-8B  ";

    expect(buildRagConfigInput(values, current).vlm_model).toBe("Qwen/Qwen3-VL-8B");
  });
});

describe("isEmbeddingChange", () => {
  it("reports a changed embedding model, ignoring surrounding whitespace", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    expect(isEmbeddingChange(values, current)).toBe(false);

    values.embedding_model = " qwen3.7-text-embedding ";
    expect(isEmbeddingChange(values, current)).toBe(false);

    values.embedding_model = "text-embedding-v4";
    expect(isEmbeddingChange(values, current)).toBe(true);
  });
});

describe("rag config client", () => {
  it("loads through the admin endpoint", async () => {
    fetchMock.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => view(),
    } as unknown as Response);

    const loaded = await loadRagConfig();

    expect(loaded.config.embedding_model).toBe("qwen3.7-text-embedding");
    const [url] = fetchMock.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/rag/config");
  });

  it("PUTs the whole object and maps a 403 to isAdminRequired", async () => {
    fetchMock.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => view(),
    } as unknown as Response);

    await saveRagConfig({ embedding_model: "x" });

    const [url, init] = fetchMock.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/rag/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ embedding_model: "x" });

    fetchMock.fetch.mockReset();
    fetchMock.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Admin privileges required" }),
    } as unknown as Response);

    await expect(saveRagConfig({})).rejects.toBeInstanceOf(RagConfigRequestError);
    await expect(saveRagConfig({})).rejects.toMatchObject({ isAdminRequired: true });
  });
});

describe("modelReferenceOptions", () => {
  const MODELS = [
    { name: "deepseek-chat", display_name: "DeepSeek Chat" },
    { name: "qwen-max", display_name: null },
  ];

  it("lists configured models after an explicit 'not configured' entry", () => {
    expect(modelReferenceOptions(MODELS, "qwen-max", "(未配置)")).toEqual([
      { value: MODEL_REFERENCE_NONE, label: "(未配置)" },
      { value: "deepseek-chat", label: "DeepSeek Chat" },
      { value: "qwen-max", label: "qwen-max" },
    ]);
  });

  it("keeps a stored value whose model was deleted", () => {
    const options = modelReferenceOptions(MODELS, "gone-model", "(未配置)");

    expect(options.at(-1)).toEqual({ value: "gone-model", label: "gone-model" });
  });

  it("does not duplicate a configured current value", () => {
    expect(
      modelReferenceOptions(MODELS, "deepseek-chat", "(未配置)").map((option) => option.value),
    ).toEqual([MODEL_REFERENCE_NONE, "deepseek-chat", "qwen-max"]);
  });
});

describe("judge model", () => {
  it("seeds the effective value and reports no change for it", () => {
    const current = view();

    expect(formValuesFromConfig(current).judge_model).toBe("deepseek-chat");
    expect(buildRagConfigInput(formValuesFromConfig(current), current)).toEqual({});
  });

  it("submits an override picked for an operator-owned judge", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    values.judge_model = "qwen-max";

    expect(buildRagConfigInput(values, current)).toEqual({ judge_model: "qwen-max" });
  });

  it("carries a file-owned judge forward and clears it when emptied", () => {
    const current = view({}, { judge_model: "ui" });
    const values = formValuesFromConfig(current);

    expect(buildRagConfigInput(values, current)).toEqual({ judge_model: "deepseek-chat" });

    values.judge_model = "";
    expect(buildRagConfigInput(values, current)).toEqual({ judge_model: "" });
  });

  it("reports an edit as a change", () => {
    const current = view();
    const values = formValuesFromConfig(current);
    values.judge_model = "qwen-max";

    expect(hasFormChanges(values, current)).toBe(true);
  });
});

describe("hasFormChanges", () => {
  it("is false right after seeding, even when the file owns fields", () => {
    const current = viewWithStoredKey();

    expect(hasFormChanges(formValuesFromConfig(current), current)).toBe(false);
  });

  it("is true once a field is edited and false again when it is reverted", () => {
    const current = view();
    const values = formValuesFromConfig(current);

    values.rerank_model = "qwen3-rerank-v2";
    expect(hasFormChanges(values, current)).toBe(true);

    values.rerank_model = current.config.rerank_model!;
    expect(hasFormChanges(values, current)).toBe(false);
  });

  it("is true when a file-owned field is cleared", () => {
    const current = viewWithStoredKey();
    const values = formValuesFromConfig(current);

    values.embedding_api_key = "";

    expect(hasFormChanges(values, current)).toBe(true);
  });

  it("ignores whitespace-only edits", () => {
    const current = view();
    const values = formValuesFromConfig(current);

    values.vlm_model = ` ${current.config.vlm_model} `;

    expect(hasFormChanges(values, current)).toBe(false);
  });
});


describe("caption model picker", () => {
  const MODELS = [
    { name: "gpt-5", model: "gpt-5", display_name: "GPT-5", supports_vision: true, provider: "openai-compatible" },
    { name: "vl", model: "Qwen/Qwen3-VL-30B", display_name: "", supports_vision: true, provider: "openai-compatible" },
    { name: "claude", model: "claude-x", display_name: "Claude X", supports_vision: true, provider: "anthropic" },
    { name: "text-only", model: "deepseek-chat", display_name: "DeepSeek", supports_vision: false, provider: "openai-compatible" },
    { name: "legacy", model: "m", display_name: "Legacy", supports_vision: true },
  ];

  it("lists the entries that can serve the caption call after the default entry", () => {
    expect(visionReferenceOptions(MODELS, "gpt-5", "(默认)")).toEqual([
      { value: MODEL_REFERENCE_NONE, label: "(默认)" },
      { value: "gpt-5", label: "GPT-5" },
      // A blank display name falls back to the registry name.
      { value: "vl", label: "vl" },
      { value: "legacy", label: "Legacy" },
    ]);
  });

  it("drops an entry the caption legs could never call, and non-vision entries", () => {
    const values = visionReferenceOptions(MODELS, "", "(默认)").map((option) => option.value);

    expect(values).not.toContain("claude"); // Anthropic is not OpenAI-compatible
    expect(values).not.toContain("text-only");
  });

  it("keeps a stored value that names no entry, so a save cannot silently drop it", () => {
    expect(visionReferenceOptions(MODELS, "qwen3.7-flash", "(默认)").at(-1)).toEqual({
      value: "qwen3.7-flash",
      label: "qwen3.7-flash",
    });
  });

  it("requires both vision support and an OpenAI-compatible provider", () => {
    expect(isCaptionCapable({ name: "a", model: "a", supports_vision: true, provider: "anthropic" })).toBe(false);
    expect(isCaptionCapable({ name: "b", model: "b" })).toBe(false);
    expect(isCaptionCapable({ name: "c", model: "c", supports_vision: true, provider: "openai-compatible" })).toBe(true);
  });
});

describe("provider dimension (spec 2026-09-14 §4.1)", () => {
  it("seeds the fields and keeps the effective defaults when the file declares none", () => {
    const values = formValuesFromConfig(view());

    expect(values.embedding_provider).toBe("dashscope");
    expect(values.embedding_sparse_source).toBe("provider");
    expect(values.rerank_provider).toBe("dashscope");
    expect(values.parse_provider).toBe("mineru-cloud");
    expect(values.parse_backend).toBe("");
    expect(values.embedding_base_url).toBe("");
  });

  it("submits the provider and endpoint the admin picked, and nothing else", () => {
    const base = formValuesFromConfig(view());
    const input = buildRagConfigInput(
      {
        ...base,
        rerank_provider: "generic-rerank",
        rerank_base_url: "http://localhost:8000",
        parse_provider: "mineru-local",
        parse_base_url: "http://localhost:30000",
      },
      view(),
    );

    expect(input.rerank_provider).toBe("generic-rerank");
    expect(input.rerank_base_url).toBe("http://localhost:8000");
    expect(input.parse_provider).toBe("mineru-local");
    expect(input.parse_base_url).toBe("http://localhost:30000");
    // An operator-owned field this edit never touched stays out of the payload.
    expect(input.embedding_provider).toBeUndefined();
  });

  it("carries the file's own provider override forward", () => {
    const owned = view({ embedding_provider: "openai-compatible" }, { embedding_provider: "ui" });

    expect(buildRagConfigInput(formValuesFromConfig(owned), owned).embedding_provider).toBe("openai-compatible");
  });

  it("treats sparse_api_key as a secret", () => {
    const owned = view({ sparse_api_key: MASKED_RAG_SECRET }, { sparse_api_key: "ui" });

    expect(buildRagConfigInput(formValuesFromConfig(owned), owned).sparse_api_key).toBe(MASKED_RAG_SECRET);
    expect(buildRagConfigInput({ ...formValuesFromConfig(owned), sparse_api_key: "" }, owned).sparse_api_key).toBe("");
    expect(buildRagConfigInput({ ...formValuesFromConfig(owned), sparse_api_key: "sk-new" }, owned).sparse_api_key).toBe(
      "sk-new",
    );
  });
});

describe("isEmbeddingChange covers the whole provider dimension", () => {
  it("reports a changed provider, endpoint or sparse source, not only the model", () => {
    const base = formValuesFromConfig(view());

    expect(isEmbeddingChange(base, view())).toBe(false);
    expect(isEmbeddingChange({ ...base, embedding_provider: "openai-compatible" }, view())).toBe(true);
    expect(isEmbeddingChange({ ...base, embedding_base_url: "http://localhost:8080/v1" }, view())).toBe(true);
    expect(isEmbeddingChange({ ...base, embedding_sparse_source: "bm25" }, view())).toBe(true);
  });
});

describe("hasFormChanges covers the provider fields", () => {
  it("reports a provider edit as a change", () => {
    const base = formValuesFromConfig(view());

    expect(hasFormChanges(base, view())).toBe(false);
    expect(hasFormChanges({ ...base, parse_provider: "mineru-local" }, view())).toBe(true);
    expect(hasFormChanges({ ...base, embedding_base_url: "http://x" }, view())).toBe(true);
  });
});

/**
 * 稀疏来源与嵌入提供商能力的交叉判定（spec 2026-09-16 §3 D2）。
 *
 * 这一层是纯逻辑，所以「拿表单当前值判定」这条由它来钉：DOM 里驱动 Radix Select 不可靠
 * （见 functional-models.dom.test.tsx 的注释），而这里可以直接把「表单里的 provider」与
 * 「已保存的 provider」构造成不同的两个值。
 */
describe("isSparseSourceUnsupported", () => {
  const PROVIDERS = [
    {
      provider_id: "dashscope",
      emits_sparse: true,
      has_fixed_endpoint: true,
      default_endpoint: "https://dashscope.aliyuncs.com",
    },
    {
      provider_id: "openai-compatible",
      emits_sparse: false,
      has_fixed_endpoint: false,
      default_endpoint: null,
    },
  ];
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(
      view({
        embedding_provider: "dashscope",
        embedding_sparse_source: "provider",
      }),
    ),
    ...over,
  });

  it("only objects to a dense-only provider that is asked for the sparse half", () => {
    expect(
      isSparseSourceUnsupported(
        form({ embedding_provider: "openai-compatible" }),
        PROVIDERS,
      ),
    ).toBe(true);
    // Same provider, sparse half sourced elsewhere.
    expect(
      isSparseSourceUnsupported(
        form({
          embedding_provider: "openai-compatible",
          embedding_sparse_source: "bm25",
        }),
        PROVIDERS,
      ),
    ).toBe(false);
    // Provider that can do it.
    expect(isSparseSourceUnsupported(form(), PROVIDERS)).toBe(false);
    expect(
      isSparseSourceUnsupported(
        form({ embedding_sparse_source: "external" }),
        PROVIDERS,
      ),
    ).toBe(false);
  });

  it("judges the form's own provider, not the one the response was seeded with", () => {
    const seeded = formValuesFromConfig(
      view({
        embedding_provider: "dashscope",
        embedding_sparse_source: "provider",
      }),
    );
    expect(seeded.embedding_provider).toBe("dashscope");
    expect(isSparseSourceUnsupported(seeded, PROVIDERS)).toBe(false);

    // …and the moment the admin switches the picker, the pair is judged as it now stands.
    expect(
      isSparseSourceUnsupported(
        { ...seeded, embedding_provider: "openai-compatible" },
        PROVIDERS,
      ),
    ).toBe(true);
  });

  it("stays quiet when the capabilities are unknown", () => {
    const editing = form({ embedding_provider: "openai-compatible" });
    expect(isSparseSourceUnsupported(editing, undefined)).toBe(false);
    expect(isSparseSourceUnsupported(editing, [])).toBe(false);
    // A provider the server did not list is unknown too, not "unsupported".
    expect(
      isSparseSourceUnsupported(
        form({
          embedding_provider: "dashscope",
          embedding_sparse_source: "provider",
        }),
        [
          {
            provider_id: "openai-compatible",
            emits_sparse: false,
            has_fixed_endpoint: false,
            default_endpoint: null,
          },
        ],
      ),
    ).toBe(false);
  });
});

/**
 * 稀疏能力是三态（spec 2026-09-16 §3 D2）：名单答得了「provider 这个方言支不支持」，
 * 答不了「这个具体模型支不支持」——后者只有一次真实探测能答。合成规则把两个来源并成一个
 * 结论，且**探测结论只对它被测的那组值有效**（换了 model / provider / 地址就当没测过）：
 * 沿用旧结论会把一个刚被否掉的值放过去。
 */
describe("resolveSparseCapability", () => {
  const PROVIDERS = [
    {
      provider_id: "dashscope",
      emits_sparse: true,
      has_fixed_endpoint: true,
      default_endpoint: "https://dashscope.aliyuncs.com",
    },
    {
      provider_id: "openai-compatible",
      emits_sparse: false,
      has_fixed_endpoint: false,
      default_endpoint: null,
    },
  ];
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(
      view({
        embedding_provider: "dashscope",
        embedding_sparse_source: "provider",
        embedding_model: "qwen3.7-text-embedding",
      }),
    ),
    ...over,
  });
  const probed = (
    values: ReturnType<typeof form>,
    status: "supported" | "unsupported" | "unverifiable",
  ) => ({ key: sparseProbeKey(values), status });

  it("answers from the allowlist when that is already the whole answer", () => {
    // A dialect that cannot carry a sparse half needs no call at all.
    expect(
      resolveSparseCapability(
        form({ embedding_provider: "openai-compatible" }),
        PROVIDERS,
        null,
      ),
    ).toBe("unsupported");
  });

  it("answers from the probe when the question is model-level", () => {
    const values = form();
    expect(
      resolveSparseCapability(values, PROVIDERS, probed(values, "supported")),
    ).toBe("supported");
    expect(
      resolveSparseCapability(values, PROVIDERS, probed(values, "unsupported")),
    ).toBe("unsupported");
    // "Could not check" is not "cannot do it": refusing here would reject working setups.
    expect(
      resolveSparseCapability(
        values,
        PROVIDERS,
        probed(values, "unverifiable"),
      ),
    ).toBe("unknown");
  });

  it("does not reuse a verdict taken for other values", () => {
    const values = form();
    const stale = probed(values, "supported");
    expect(
      resolveSparseCapability(
        form({ embedding_model: "bge-m3" }),
        PROVIDERS,
        stale,
      ),
    ).toBe("unknown");
    expect(
      resolveSparseCapability(
        form({ embedding_base_url: "https://elsewhere.example.com" }),
        PROVIDERS,
        stale,
      ),
    ).toBe("unknown");
    expect(
      resolveSparseCapability(
        form({ embedding_provider: "openai-compatible" }),
        PROVIDERS,
        stale,
      ),
    ).toBe("unsupported"); // the allowlist still knows; only the probe's half is void
  });

  it("stays unknown until something has actually been probed", () => {
    expect(resolveSparseCapability(form(), PROVIDERS, null)).toBe("unknown");
    // A server that predates the capability block cannot be answered for — and must not be
    // answered with a guess either.
    expect(resolveSparseCapability(form(), undefined, null)).toBe("unknown");
    expect(resolveSparseCapability(form(), [], null)).toBe("unknown");
  });
});

describe("sparseProbeKey", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(view({ embedding_sparse_source: "provider" })),
    ...over,
  });

  it("binds a verdict to the provider, the model and the endpoint", () => {
    expect(sparseProbeKey(form())).toBe("dashscope|qwen3.7-text-embedding|");
    expect(
      sparseProbeKey(
        form({
          embedding_provider: "openai-compatible",
          embedding_model: "bge-m3",
          embedding_base_url: "https://api.example.com",
        }),
      ),
    ).toBe("openai-compatible|bge-m3|https://api.example.com");
  });

  it("ignores the fields a probe does not depend on", () => {
    // The verdict is about (provider, model, endpoint) — the sparse source is the question
    // being asked, and rerank/judge/… are other legs entirely.
    const base = form();
    expect(sparseProbeKey({ ...base, embedding_sparse_source: "bm25" })).toBe(
      sparseProbeKey(base),
    );
    expect(sparseProbeKey({ ...base, rerank_model: "other" })).toBe(
      sparseProbeKey(base),
    );
  });
});

describe("isSparseProviderOptionDisabled", () => {
  it("disables the follow-the-model option only on a known refusal", () => {
    expect(isSparseProviderOptionDisabled("unsupported")).toBe(true);
    // Supported and "could not check" both stay selectable: the second one is the whole
    // point of the third state (a network failure must not lock a working configuration).
    expect(isSparseProviderOptionDisabled("supported")).toBe(false);
    expect(isSparseProviderOptionDisabled("unknown")).toBe(false);
  });
});

/**
 * 「独立稀疏服务」但没挑提供商 —— 这份配置后端**必定拒绝**（`external` 需要具体的
 * `sparse_provider`），而界面上原来既不提示、也能保存，直到那一次 400 才知道。
 * 这是同一条纪律的最后一个洞：能确定会被拒的组合，编辑期就要说。
 */
describe("isSparseServiceUnconfigured", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(view({ embedding_sparse_source: "external" })),
    ...over,
  });

  it("objects to an external service with no provider chosen", () => {
    // The empty id is what a fresh external config seeds (Radix needs a non-empty value, so
    // "not chosen" travels as ""), and the runtime refuses exactly that pair.
    expect(isSparseServiceUnconfigured(form({ sparse_provider: "" }))).toBe(
      true,
    );
    expect(
      isSparseServiceUnconfigured(form({ sparse_provider: "tei-sparse" })),
    ).toBe(false);
  });

  it("leaves the other two sources alone", () => {
    expect(
      isSparseServiceUnconfigured(
        form({ embedding_sparse_source: "provider", sparse_provider: "" }),
      ),
    ).toBe(false);
    expect(
      isSparseServiceUnconfigured(
        form({ embedding_sparse_source: "bm25", sparse_provider: "" }),
      ),
    ).toBe(false);
  });
});

/**
 * 外部稀疏服务的连通性探针的前端纯逻辑（spec 2026-09-16 connectivity §3 D4）：**什么时候该探**、
 * **结论属于谁**。这两件事决定了「地址改一下」会不会带上旧结论、以及会不会对着空地址发请求。
 */
describe("sparse service probe", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(
      view({
        embedding_sparse_source: "external",
        sparse_provider: "tei-sparse",
        sparse_base_url: "http://127.0.0.1:8081",
      }),
    ),
    ...over,
  });

  it("asks only when the form actually uses an external service with an address", () => {
    expect(shouldProbeSparseService(form())).toBe(true);
    // Nothing to reach yet.
    expect(shouldProbeSparseService(form({ sparse_base_url: "" }))).toBe(false);
    expect(shouldProbeSparseService(form({ sparse_base_url: "   " }))).toBe(
      false,
    );
    // No provider chosen: `external` requires one, so there is nothing to call.
    expect(shouldProbeSparseService(form({ sparse_provider: "" }))).toBe(false);
    // The other two sources never leave the machine.
    expect(
      shouldProbeSparseService(form({ embedding_sparse_source: "provider" })),
    ).toBe(false);
    expect(
      shouldProbeSparseService(form({ embedding_sparse_source: "bm25" })),
    ).toBe(false);
  });

  it("binds a verdict to the address it was taken for, and to whether a key exists", () => {
    const values = form();
    expect(sparseServiceProbeKey(values, false)).toBe(
      "tei-sparse|http://127.0.0.1:8081|nokey",
    );
    expect(sparseServiceProbeKey(values, true)).toBe(
      "tei-sparse|http://127.0.0.1:8081|key",
    );
    // A trim is not an edit.
    expect(
      sparseServiceProbeKey(
        form({ sparse_base_url: " http://127.0.0.1:8081 " }),
        false,
      ),
    ).toBe(sparseServiceProbeKey(values, false));
  });

  it("hands back a verdict only for the values it was taken for", () => {
    const values = form();
    const key = sparseServiceProbeKey(values, false);
    expect(
      sparseServiceVerdictFor(values, false, { key, status: "unreachable" }),
    ).toEqual({ key, status: "unreachable" });
    // Another address is another question — and so is "a key appeared".
    expect(
      sparseServiceVerdictFor(
        form({ sparse_base_url: "http://127.0.0.1:8082" }),
        false,
        { key, status: "ok" },
      ),
    ).toBeNull();
    expect(
      sparseServiceVerdictFor(values, true, { key, status: "ok" }),
    ).toBeNull();
    expect(sparseServiceVerdictFor(values, false, null)).toBeNull();
  });
});

/**
 * 嵌入地址那一行（spec 2026-09-17 §3 D1/D6）：哪些 provider 的地址「由提供方固定」、
 * 锁框里该显示什么、以及**存量地址仍然生效**（百炼的 workspace 级地址就靠这一条活着）。
 * 判据来自能力块，不写死 provider 名——加第二家之后就不会漏。
 */
describe("embedding provider options and the fixed-endpoint row", () => {
  const PROVIDERS = [
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
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(view()),
    ...over,
  });

  it("offers the Ark dialect alongside the other two", () => {
    expect(EMBEDDING_PROVIDER_OPTIONS).toContain("volcengine-ark");
    // The picker renders this order; the two dual-path dialects sit together.
    expect([...EMBEDDING_PROVIDER_OPTIONS]).toEqual([
      "dashscope",
      "volcengine-ark",
      "openai-compatible",
    ]);
  });

  it("locks a provider that fixes its own endpoint and shows where it will call", () => {
    expect(resolveFixedEndpointRow(form(), PROVIDERS)).toEqual({
      locked: true,
      shown: "https://dashscope.aliyuncs.com",
      overridden: false,
    });
    expect(
      resolveFixedEndpointRow(
        form({ embedding_provider: "volcengine-ark" }),
        PROVIDERS,
      ),
    ).toEqual({
      locked: true,
      shown: "https://ark.cn-beijing.volces.com",
      overridden: false,
    });
  });

  it("keeps a stored address in play and marks it as the admin's own", () => {
    // ⑤-4：存量值仍然生效（否则百炼的 workspace 级地址就配不了了），只是变成「看得见」。
    expect(
      resolveFixedEndpointRow(
        form({
          embedding_provider: "volcengine-ark",
          embedding_base_url: "https://ws-example.cn-beijing.maas.aliyuncs.com",
        }),
        PROVIDERS,
      ),
    ).toEqual({
      locked: true,
      shown: "https://ws-example.cn-beijing.maas.aliyuncs.com",
      overridden: true,
    });
  });

  it("leaves a provider without a fixed endpoint editable", () => {
    expect(
      resolveFixedEndpointRow(
        form({
          embedding_provider: "openai-compatible",
          embedding_base_url: "http://127.0.0.1:8080/v1",
        }),
        PROVIDERS,
      ),
    ).toEqual({
      locked: false,
      shown: "http://127.0.0.1:8080/v1",
      overridden: false,
    });
  });

  it("does not lock anything when the server has no capability block", () => {
    // 旧响应答不了这个问题 ⇒ 不替它答：留成可编辑，而不是猜一个"锁"。
    expect(resolveFixedEndpointRow(form(), undefined)).toEqual({
      locked: false,
      shown: "",
      overridden: false,
    });
  });
});

/**
 * The rerank row answers the *same* question as the embedding one, from its own block
 * (spec 2026-09-17 alignment §3 D4). Kept as a separate wrapper over one core so the two rows
 * cannot drift into two copies of the judgement — which is exactly how the rerank row ended up
 * hardcoding a provider name in the first place.
 */
describe("rerank endpoint row reads its own capability block", () => {
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
  const form = (over: Record<string, unknown> = {}) => ({
    ...formValuesFromConfig(view()),
    ...over,
  });

  it("locks a provider that fixes its own endpoint and shows where it will call", () => {
    expect(
      resolveRerankEndpointRow(
        form({ rerank_provider: "dashscope" }),
        RERANK_PROVIDERS,
      ),
    ).toEqual({
      locked: true,
      shown: "https://dashscope.aliyuncs.com",
      overridden: false,
    });
  });

  it("keeps a stored address in play and marks it as the admin's own", () => {
    expect(
      resolveRerankEndpointRow(
        form({
          rerank_provider: "dashscope",
          rerank_base_url: "http://127.0.0.1:9999",
        }),
        RERANK_PROVIDERS,
      ),
    ).toEqual({
      locked: true,
      shown: "http://127.0.0.1:9999",
      overridden: true,
    });
  });

  it("leaves a provider without a fixed endpoint editable", () => {
    expect(
      resolveRerankEndpointRow(
        form({
          rerank_provider: "generic-rerank",
          rerank_base_url: "http://localhost:8000",
        }),
        RERANK_PROVIDERS,
      ),
    ).toEqual({
      locked: false,
      shown: "http://localhost:8000",
      overridden: false,
    });
  });

  it("does not lock anything when the server has no rerank capability block", () => {
    // `unknown ≠ cannot`，与嵌入那行同一条规矩：旧的网关答不了这个问题，就别替它猜。
    expect(
      resolveRerankEndpointRow(
        form({ rerank_provider: "dashscope" }),
        undefined,
      ),
    ).toEqual({
      locked: false,
      shown: "",
      overridden: false,
    });
  });
});
