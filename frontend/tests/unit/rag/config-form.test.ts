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
  isEmbeddingChange,
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
      mineru_api_token: "",
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
      mineru_api_token: "unset",
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
