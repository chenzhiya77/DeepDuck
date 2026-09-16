import { MASKED_RAG_SECRET } from "./api";
import type {
  RagConfigValues,
  RagConfigView,
  RagConfigInput,
  RagEmbeddingProviderCapability,
  RagVideoValues,
} from "./types";

/**
 * Form mapping for the RAG functional-model view (spec 2026-09-10 §5).
 *
 * The backend PUT replaces the whole API-writable object, so the payload is *not* a
 * patch: whatever it omits is removed from the file and reverts to `config.yaml` (or,
 * for a secret, to the environment). That makes two rules load-bearing:
 *
 * 1. Fields the file already owns are carried forward, so editing one row cannot
 *    silently drop the file's other overrides.
 * 2. An untouched stored secret is re-submitted as the sentinel so the server keeps it;
 *    emptying the input is the explicit "stop overriding, fall back to the environment".
 *
 * Fields the operator owns (source `config_file`) are only submitted once the admin
 * actually overrides them — otherwise saving the form would freeze today's `config.yaml`
 * values into the file and silently outrank every later operator edit.
 */

/** One editable row of the functional-model form. */
export interface RagConfigFormValues {
  qdrant_url: string;
  embedding_model: string;
  embedding_api_key: string;
  rerank_model: string;
  rerank_api_key: string;
  vlm_model: string;
  vlm_base_url: string;
  vlm_api_key: string;
  extract_model: string;
  judge_model: string;
  mineru_api_token: string;
  embedding_provider: "dashscope" | "openai-compatible";
  embedding_base_url: string;
  embedding_sparse_source: "provider" | "external" | "bm25";
  sparse_provider: "tei-sparse" | "";
  sparse_base_url: string;
  sparse_model: string;
  sparse_api_key: string;
  rerank_provider: "dashscope" | "generic-rerank";
  rerank_base_url: string;
  parse_provider: "mineru-cloud" | "mineru-local";
  parse_base_url: string;
  parse_backend: "vlm" | "hybrid" | "";
  video: {
    asr_provider: "funasr" | "whisper";
    asr_model: string;
    caption_model: string;
  };
}

/**
 * The select options for the provider dimension. These mirror the backend's curated
 * allowlist (`deerflow.knowledge.providers`), which is the authority: a value outside it
 * is rejected with a 422 rather than silently accepted, so drift shows up loudly.
 */
export const EMBEDDING_PROVIDER_OPTIONS = ["dashscope", "openai-compatible"] as const;
export const EMBEDDING_SPARSE_SOURCE_OPTIONS = ["provider", "external", "bm25"] as const;
/** The sparse service's id set: one verified shape (TEI's `/embed_sparse`), spec §4.2. */
export const SPARSE_PROVIDER_OPTIONS = ["", "tei-sparse"] as const;
export const RERANK_PROVIDER_OPTIONS = ["dashscope", "generic-rerank"] as const;
export const PARSE_PROVIDER_OPTIONS = ["mineru-cloud", "mineru-local"] as const;
/** Empty means "let the local MinerU service decide"; `pipeline` is outside the support surface. */
export const PARSE_BACKEND_OPTIONS = ["", "vlm", "hybrid"] as const;

const SECRET_FIELDS = [
  "embedding_api_key",
  "rerank_api_key",
  "vlm_api_key",
  "mineru_api_token",
  "sparse_api_key",
] as const;

const TEXT_FIELDS = [
  "qdrant_url",
  "embedding_model",
  "rerank_model",
  "vlm_model",
  "vlm_base_url",
  "extract_model",
  "judge_model",
  "embedding_base_url",
  "sparse_base_url",
  "sparse_model",
  "rerank_base_url",
  "parse_base_url",
] as const;

/** Enum selects: they carry their own union type, so they are handled apart from text. */
const SELECT_FIELDS = [
  "embedding_provider",
  "embedding_sparse_source",
  "sparse_provider",
  "rerank_provider",
  "parse_provider",
  "parse_backend",
] as const;

const VIDEO_SOURCES: Record<string, string> = {
  asr_provider: "video.asr_provider",
  asr_model: "video.asr_model",
  caption_model: "video.caption_model",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Narrow a wire value onto one of a select's options, falling back when it is absent or unknown. */
function asEnum<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Effective view → form values; a stored secret stays masked so the input shows it as set. */
export function formValuesFromConfig(view: RagConfigView): RagConfigFormValues {
  const config = view.config ?? {};
  const video: RagVideoValues = config.video ?? {};
  return {
    qdrant_url: asText(config.qdrant_url),
    embedding_model: asText(config.embedding_model),
    embedding_api_key: asText(config.embedding_api_key),
    rerank_model: asText(config.rerank_model),
    rerank_api_key: asText(config.rerank_api_key),
    vlm_model: asText(config.vlm_model),
    vlm_base_url: asText(config.vlm_base_url),
    vlm_api_key: asText(config.vlm_api_key),
    extract_model: asText(config.extract_model),
    judge_model: asText(config.judge_model),
    mineru_api_token: asText(config.mineru_api_token),
    embedding_provider: asEnum(config.embedding_provider, EMBEDDING_PROVIDER_OPTIONS, "dashscope"),
    embedding_base_url: asText(config.embedding_base_url),
    embedding_sparse_source: asEnum(config.embedding_sparse_source, EMBEDDING_SPARSE_SOURCE_OPTIONS, "provider"),
    sparse_provider: asEnum(config.sparse_provider, SPARSE_PROVIDER_OPTIONS, ""),
    sparse_base_url: asText(config.sparse_base_url),
    sparse_model: asText(config.sparse_model),
    sparse_api_key: asText(config.sparse_api_key),
    rerank_provider: asEnum(config.rerank_provider, RERANK_PROVIDER_OPTIONS, "dashscope"),
    rerank_base_url: asText(config.rerank_base_url),
    parse_provider: asEnum(config.parse_provider, PARSE_PROVIDER_OPTIONS, "mineru-cloud"),
    parse_base_url: asText(config.parse_base_url),
    parse_backend: asEnum(config.parse_backend, PARSE_BACKEND_OPTIONS, ""),
    video: {
      asr_provider: video.asr_provider === "whisper" ? "whisper" : "funasr",
      asr_model: asText(video.asr_model),
      caption_model: asText(video.caption_model),
    },
  };
}

function owned(view: RagConfigView, key: string): boolean {
  return view.sources?.[key] === "ui";
}

function loaded(view: RagConfigView, key: keyof RagConfigValues): string {
  return asText(view.config?.[key]);
}

/** Write one field of the payload; the caller has already narrowed the key and value. */
function writeField(input: RagConfigInput, key: string, value: unknown): void {
  (input as Record<string, unknown>)[key] = value;
}

/**
 * Build the PUT body: the file's current overrides carried forward, plus this edit.
 *
 * Returns `{}` when the admin changed nothing and the file owns nothing — the caller
 * must treat an empty payload as "nothing to save" (sending it would clear the file).
 */
export function buildRagConfigInput(
  values: RagConfigFormValues,
  view: RagConfigView,
): RagConfigInput {
  const input: RagConfigInput = {};

  for (const key of TEXT_FIELDS) {
    const next = values[key].trim();
    const previous = loaded(view, key);
    if (next === previous) {
      if (next !== "" && owned(view, key)) {
        input[key] = next; // carry the file's own override forward
      }
      continue;
    }
    // An override this edit introduces (or, when the file owns the field, an explicit clear).
    if (next !== "" || owned(view, key)) {
      input[key] = next;
    }
  }

  for (const key of SECRET_FIELDS) {
    const next = values[key].trim();
    if (next === MASKED_RAG_SECRET) {
      if (owned(view, key)) {
        input[key] = MASKED_RAG_SECRET; // keep the stored key
      }
      continue;
    }
    if (next === "") {
      if (owned(view, key)) {
        input[key] = ""; // stop overriding: fall back to the environment
      }
      continue;
    }
    input[key] = next;
  }

  // Enum selects follow the same carry-forward rule. They write through a widened view
  // because their option unions differ per field, which TS cannot prove from a key union.
  for (const key of SELECT_FIELDS) {
    const next = values[key];
    const previous = asText(view.config?.[key]);
    if (next === previous) {
      if (next !== "" && owned(view, key)) writeField(input, key, next); // carry the file's own override
      continue;
    }
    if (next !== "" || owned(view, key)) writeField(input, key, next);
  }

  const video: RagVideoValues = {};
  const loadedVideo: RagVideoValues = view.config?.video ?? {};

  // The two free-text fields share one rule...
  for (const key of ["asr_model", "caption_model"] as const) {
    const source = VIDEO_SOURCES[key]!;
    const previous = asText(loadedVideo[key]);
    const next = values.video[key].trim();
    if (next === previous) {
      if (next !== "" && owned(view, source)) {
        video[key] = next;
      }
      continue;
    }
    if (next !== "" || owned(view, source)) {
      video[key] = next;
    }
  }

  // ...while the provider is an enum select, so it keeps its own union type.
  const provider: "funasr" | "whisper" =
    values.video.asr_provider === "whisper" ? "whisper" : "funasr";
  const loadedProvider: "funasr" | "whisper" =
    loadedVideo.asr_provider === "whisper" ? "whisper" : "funasr";
  if (provider !== loadedProvider || owned(view, VIDEO_SOURCES.asr_provider!)) {
    video.asr_provider = provider;
  }
  if (Object.keys(video).length > 0) {
    input.video = video;
  }

  return input;
}

/**
 * Whether this edit invalidates the vectors of every knowledge base already indexed — which
 * means re-indexing, not just a settings change. It covers the whole provider dimension
 * (spec 2026-09-14 §5), not only the model name: switching provider, endpoint or sparse
 * source changes the vectors too, so warning on the model alone would miss most switches.
 */
export function isEmbeddingChange(
  values: RagConfigFormValues,
  view: RagConfigView,
): boolean {
  const seeded = formValuesFromConfig(view);
  return (
    values.embedding_model.trim() !== seeded.embedding_model.trim() ||
    values.embedding_provider !== seeded.embedding_provider ||
    values.embedding_base_url.trim() !== seeded.embedding_base_url.trim() ||
    values.embedding_sparse_source !== seeded.embedding_sparse_source
  );
}

/**
 * Whether the form asks the selected embedding provider for a sparse half it cannot produce
 * (spec 2026-09-16 §3 D2) — the one combination the pipeline refuses to build, so the admin
 * should hear about it here rather than on the next ingest.
 *
 * Judged from the **form's** provider, not the seeded one: switching the picker has to warn
 * immediately, before anything is saved. `providers` is the server's capability list; missing
 * data — an older response, or a provider the server did not list — answers `false`, because
 * an unknown is not a defect and warning about what we cannot know is worse than silence.
 *
 * `probe` adds the model-level answer (see `resolveSparseCapability`), so a model the platform
 * itself refused is caught the same way as a dense-only dialect.
 */
export function isSparseSourceUnsupported(
  values: RagConfigFormValues,
  providers: readonly RagEmbeddingProviderCapability[] | undefined,
  probe?: SparseProbeVerdict | null,
): boolean {
  if (values.embedding_sparse_source !== "provider") return false;
  return resolveSparseCapability(values, providers, probe) === "unsupported";
}

/**
 * What a probe learned about one candidate configuration (spec 2026-09-16 §3 D3), carrying the
 * values it was taken for. The key is not decoration: a verdict without it would be applied to
 * whatever the form says later, which is exactly how a just-refused model slips through.
 */
export interface SparseProbeVerdict {
  key: string;
  status: "supported" | "unsupported" | "unverifiable";
}

/**
 * The identity a probe verdict belongs to (spec §3 D4.2): the three values that decide what the
 * call would actually ask. Everything else on the form is a different leg or a different
 * question — the sparse source *is* the question being asked, so it is deliberately not part of
 * the key.
 */
export function sparseProbeKey(values: RagConfigFormValues): string {
  return [
    values.embedding_provider,
    values.embedding_model.trim(),
    values.embedding_base_url.trim(),
  ].join("|");
}

/** The three-state answer the UI renders (spec §3 D2). */
export type SparseCapability = "supported" | "unsupported" | "unknown";

/**
 * Combine the two sources that know something about the sparse half (spec §3 D2).
 *
 * The allowlist answers the *dialect* question for free — a provider that cannot emit sparse at
 * all needs no call. Whether a particular model on a capable provider does is only knowable by
 * asking it, so that answer is taken from the probe, and **only** when the probe was run for
 * exactly these values. Anything unproven is `unknown`, which the caller must treat as no worse
 * than today (see `isSparseProviderOptionDisabled`).
 */
export function resolveSparseCapability(
  values: RagConfigFormValues,
  providers: readonly RagEmbeddingProviderCapability[] | undefined,
  probe: SparseProbeVerdict | null | undefined,
): SparseCapability {
  const capability = providers?.find(
    (provider) => provider.provider_id === values.embedding_provider,
  );
  if (capability?.emits_sparse === false) return "unsupported";
  if (probe?.key !== sparseProbeKey(values)) return "unknown";
  if (probe.status === "supported") return "supported";
  if (probe.status === "unsupported") return "unsupported";
  // "Could not check" is not "cannot do it".
  return "unknown";
}

/**
 * Whether the 「跟随向量模型」 option has to be picked-but-unselectable (spec §3 D4.1).
 *
 * Only a *known* refusal disables it: treating `unknown` as a refusal would lock a working
 * configuration out the moment the platform is unreachable, which is worse than the silence
 * this whole line set out to fix.
 */
export function isSparseProviderOptionDisabled(
  capability: SparseCapability,
): boolean {
  return capability === "unsupported";
}

/** Radix Select rejects an empty item value, so "not configured" gets its own token. */
export const MODEL_REFERENCE_NONE = "__none__";

export interface ModelReferenceOption {
  value: string;
  label: string;
}

/**
 * Options for a picker whose value is a `models:` entry name (graph extraction, eval
 * judge): the configured chat models, with an explicit "not configured" entry that means
 * "let the backend pick". A stored value whose model was deleted stays listed (labelled
 * as itself) so opening the form cannot silently clear it.
 */
export function modelReferenceOptions(
  models: readonly { name: string; display_name?: string | null }[],
  current: string,
  noneLabel: string,
): ModelReferenceOption[] {
  const options: ModelReferenceOption[] = [
    { value: MODEL_REFERENCE_NONE, label: noneLabel },
  ];
  for (const model of models) {
    const display = model.display_name?.trim();
    const hasDisplay = display !== undefined && display.length > 0;
    options.push({ value: model.name, label: hasDisplay ? display : model.name });
  }
  if (current && !models.some((model) => model.name === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}
/**
 * Whether the admin edited anything. Carrying the file's own fields forward is not an
 * edit, so a pristine form must keep Save disabled (re-submitting identical content is a
 * pointless write, and an empty payload would clear the file).
 */
export function hasFormChanges(
  values: RagConfigFormValues,
  view: RagConfigView,
): boolean {
  const seeded = formValuesFromConfig(view);
  const edited = (a: string, b: string) => a.trim() !== b.trim();
  return (
    TEXT_FIELDS.some((key) => edited(values[key], seeded[key])) ||
    SECRET_FIELDS.some((key) => edited(values[key], seeded[key])) ||
    SELECT_FIELDS.some((key) => values[key] !== seeded[key]) ||
    (["asr_provider", "asr_model", "caption_model"] as const).some((key) =>
      edited(values.video[key], seeded.video[key]),
    )
  );
}

/** The bits of a configured model the caption picker needs. */
export interface VisionModelSource {
  name: string;
  model: string;
  display_name?: string | null;
  supports_vision?: boolean;
  provider?: string | null;
}

/**
 * Whether an entry can serve as the caption VLM. The caption legs post to an
 * OpenAI-compatible `/chat/completions`, so an Anthropic entry could never work however it is
 * configured.
 */
export function isCaptionCapable(model: VisionModelSource): boolean {
  return Boolean(model.supports_vision) && model.provider !== "anthropic";
}

/**
 * Options for the caption (VLM) picker: the entries that can actually serve it, an explicit
 * "use the configured default" entry, and — through `modelReferenceOptions` — a stored value
 * that names no entry, so opening the form cannot silently drop it. Values are entry *names*:
 * the backend resolves the endpoint and key from that entry, which is why this row needs no
 * endpoint and no key input.
 */
export function visionReferenceOptions(
  models: readonly VisionModelSource[],
  current: string,
  noneLabel: string,
): ModelReferenceOption[] {
  return modelReferenceOptions(models.filter(isCaptionCapable), current, noneLabel);
}
