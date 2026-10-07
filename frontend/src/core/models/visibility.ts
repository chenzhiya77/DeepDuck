import type { Model } from "./types";

/**
 * Options for the three chat model pickers (spec 2026-10-08
 * models-list-grouping §2④): hidden entries drop out of the *options*, but the
 * default model (merged first) is always exempt (review ★1) — the name list is
 * persistent data, so a config.yaml change can promote a hidden name to first
 * place, and without the exemption the composer would preselect a model the
 * dropdown does not show. The caller's full list stays untouched: selection and
 * fallback lookups (`models.find` / `models[0]`) keep seeing everything (D3 —
 * hiding means "not in the way", never "disabled").
 */
export function chatPickerOptions(models: Model[]): Model[] {
  const defaultName = models[0]?.name;
  return models.filter((model) => {
    return !model.hidden_in_chat || model.name === defaultName;
  });
}
