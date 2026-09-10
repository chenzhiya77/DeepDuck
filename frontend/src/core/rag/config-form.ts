import { MASKED_RAG_SECRET } from "./api";
import type {
  RagConfigValues,
  RagConfigView,
  RagConfigInput,
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
  video: {
    asr_provider: "funasr" | "whisper";
    asr_model: string;
    caption_model: string;
  };
}

const SECRET_FIELDS = [
  "embedding_api_key",
  "rerank_api_key",
  "vlm_api_key",
  "mineru_api_token",
] as const;

const TEXT_FIELDS = [
  "qdrant_url",
  "embedding_model",
  "rerank_model",
  "vlm_model",
  "vlm_base_url",
  "extract_model",
  "judge_model",
] as const;

const VIDEO_SOURCES: Record<string, string> = {
  asr_provider: "video.asr_provider",
  asr_model: "video.asr_model",
  caption_model: "video.caption_model",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
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
 * Whether this edit replaces the embedding model, which invalidates the vectors of every
 * knowledge base already indexed with the previous one (they need re-indexing).
 */
export function isEmbeddingChange(
  values: RagConfigFormValues,
  view: RagConfigView,
): boolean {
  return values.embedding_model.trim() !== loaded(view, "embedding_model");
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
