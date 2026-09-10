import type {
  ManagedModelInput,
  ProviderId,
  ReasoningEffortLevel,
} from "./types";

/**
 * Batch-add expansion (spec 2026-09-10 §5.3.1).
 *
 * The web "add models" dialog collects ONE shared credential block plus N
 * Model IDs. `models_config.json` stays a flat per-model list, so the client
 * expands the shared block into N independent entries — each carrying its own
 * copy of the provider / endpoint / api_key / capabilities. Sharing happens only
 * at creation time; afterwards each model is independent. The backend contract is
 * a whole-collection `PUT /api/models/config`.
 */

export interface BatchSharedFields {
  provider: ProviderId;
  endpoint?: string;
  apiKey?: string;
  /** "chat" (default) or "responses"; only meaningful for openai-compatible. */
  apiType?: "chat" | "responses";
  supportsThinking?: boolean;
  supportsVision?: boolean;
  supportsReasoningEffort?: boolean;
  /** Legacy single default window, for callers that declare no subset. */
  contextWindow?: number;
  /** Selected window subset (multi-select, `CONTEXT_WINDOW_OPTIONS` members). */
  supportedWindows?: number[];
  /** Default window; carried only when it is a member of `supportedWindows`. */
  defaultWindow?: number;
  /** Selected effort subset (multi-select, enum order). */
  supportedEfforts?: ReasoningEffortLevel[];
  /** Default effort; carried only when it is a member of `supportedEfforts`. */
  defaultEffort?: ReasoningEffortLevel;
}

/** An unset or unselected multi-select means "no declared subset", never `[]`. */
function declaredSubset<T>(values: readonly T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? [...values] : undefined;
}

/** The backend rejects a default outside the declared subset, so drop it instead. */
function gatedDefault<T>(
  value: T | undefined,
  subset: readonly T[] | undefined,
): T | undefined {
  return value !== undefined && subset?.includes(value) ? value : undefined;
}

/**
 * Return `desired` if unused, else the first `desired-2`, `desired-3`, … that is
 * free. Mirrors the naming rule frozen in spec §5.3.1.
 */
export function uniqueModelName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired;
  let suffix = 2;
  while (taken.has(`${desired}-${suffix}`)) suffix += 1;
  return `${desired}-${suffix}`;
}

/**
 * Expand a shared credential block + a list of Model IDs into flat entries.
 *
 * - Empty / whitespace-only ids are skipped.
 * - `name` = Model ID, deduped against `existingNames` and within the batch.
 * - `display_name` defaults to the Model ID.
 * - `use_responses_api` is set only for openai-compatible + "responses".
 * - A declared window/effort subset is carried with its default, and the default
 *   is dropped when it falls outside the subset. Without a declared subset the
 *   legacy single `contextWindow` keeps its old "default window" meaning.
 */
export function expandBatchToEntries(
  shared: BatchSharedFields,
  modelIds: string[],
  existingNames: Iterable<string>,
): ManagedModelInput[] {
  const taken = new Set(existingNames);
  const entries: ManagedModelInput[] = [];
  const useResponsesApi =
    shared.provider === "openai-compatible" && shared.apiType === "responses";
  const windows = declaredSubset(shared.supportedWindows);
  const efforts = declaredSubset(shared.supportedEfforts);
  const windowDefault = windows
    ? gatedDefault(shared.defaultWindow, windows)
    : shared.contextWindow;
  const effortDefault = gatedDefault(shared.defaultEffort, efforts);

  for (const rawId of modelIds) {
    const modelId = rawId.trim();
    if (!modelId) continue;
    const name = uniqueModelName(modelId, taken);
    taken.add(name);

    const entry: ManagedModelInput = {
      provider: shared.provider,
      name,
      model: modelId,
      display_name: modelId,
      supports_thinking: Boolean(shared.supportsThinking),
      supports_vision: Boolean(shared.supportsVision),
      supports_reasoning_effort: Boolean(shared.supportsReasoningEffort),
    };
    if (shared.apiKey) entry.api_key = shared.apiKey;
    if (shared.endpoint) entry.endpoint = shared.endpoint;
    if (windows) entry.supported_context_windows = [...windows];
    if (windowDefault !== undefined) entry.context_window = windowDefault;
    if (efforts) entry.supported_reasoning_efforts = [...efforts];
    if (effortDefault !== undefined) entry.reasoning_effort = effortDefault;
    if (useResponsesApi) entry.use_responses_api = true;
    entries.push(entry);
  }

  return entries;
}
