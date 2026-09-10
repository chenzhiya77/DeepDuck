import type { ManagedModelInput, ProviderId } from "./types";

/**
 * Batch-add expansion (spec 2026-09-10 §5.3.1).
 *
 * The web "add models" dialog collects ONE shared credential block plus N
 * Model IDs. `models_config.json` stays a flat per-model list, so the client
 * expands the shared block into N independent entries — each carrying its own
 * copy of the provider / endpoint / api_key. Sharing happens only at creation
 * time; afterwards each model is independent. The backend contract is unchanged
 * (a whole-collection `PUT /api/models/config`).
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
  contextWindow?: number;
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
    if (shared.contextWindow) entry.context_window = shared.contextWindow;
    if (useResponsesApi) entry.use_responses_api = true;
    entries.push(entry);
  }

  return entries;
}
