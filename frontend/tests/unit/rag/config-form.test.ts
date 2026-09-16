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
  formValuesFromConfig,
  hasFormChanges,
  isCaptionCapable,
  isEmbeddingChange,
  isSparseSourceUnsupported,
  MODEL_REFERENCE_NONE,
  modelReferenceOptions,
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
    const values = formValuesFromConfig({ config: {}, sources: {} });

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
    { provider_id: "dashscope", emits_sparse: true },
    { provider_id: "openai-compatible", emits_sparse: false },
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
        [{ provider_id: "openai-compatible", emits_sparse: false }],
      ),
    ).toBe(false);
  });
});
