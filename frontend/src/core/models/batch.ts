import { capabilityFieldsFromShared } from "./capability";
import type { CapabilitySharedFields } from "./capability";
import type { ManagedModelInput, ProviderId } from "./types";

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

export interface BatchSharedFields extends CapabilitySharedFields {
  provider: ProviderId;
  endpoint?: string;
  apiKey?: string;
  /** "chat" (default) or "responses"; only meaningful for openai-compatible. */
  apiType?: "chat" | "responses";
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
 * - Capability subsets/defaults are carried per entry with the shared gating
 *   rules (`capabilityFieldsFromShared`).
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
  const capability = capabilityFieldsFromShared(shared);

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
    if (capability.supported_context_windows) {
      entry.supported_context_windows = [
        ...capability.supported_context_windows,
      ];
    }
    if (capability.context_window !== undefined) {
      entry.context_window = capability.context_window;
    }
    if (capability.supported_reasoning_efforts) {
      entry.supported_reasoning_efforts = [
        ...capability.supported_reasoning_efforts,
      ];
    }
    if (capability.reasoning_effort !== undefined) {
      entry.reasoning_effort = capability.reasoning_effort;
    }
    if (useResponsesApi) entry.use_responses_api = true;
    entries.push(entry);
  }

  return entries;
}
