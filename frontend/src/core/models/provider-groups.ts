import type { ProviderId } from "./types";

/**
 * The provider dropdown's grouping table (spec 2026-09-22 provider-grouping
 * §3.1 / D1–D3). The three ids are two different kinds of thing: the generic
 * protocols first — any service that speaks OpenAI's or Anthropic's shape —
 * and the vendor-native clients second.
 *
 * The dialog renders from this table instead of hardcoding three rows, and the
 * label keys go through a `Record` on purpose: a new `ProviderId` fails the
 * type check here before any test can notice it never got grouped.
 */

export interface ProviderGroup {
  readonly labelKey: "providerGroupGeneric" | "providerGroupVendor";
  readonly ids: readonly ProviderId[];
}

export const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  { labelKey: "providerGroupGeneric", ids: ["openai-compatible", "anthropic"] },
  { labelKey: "providerGroupVendor", ids: ["deepseek"] },
];

export const PROVIDER_LABEL_KEYS: Record<
  ProviderId,
  "providerOpenaiCompatible" | "providerAnthropic" | "providerDeepseek"
> = {
  "openai-compatible": "providerOpenaiCompatible",
  anthropic: "providerAnthropic",
  deepseek: "providerDeepseek",
};
