import type { ReasoningEffortLevel } from "./types";

/**
 * Curated capability suggestions for well-known model ids (spec 2026-09-10 §5.3.2).
 *
 * These are ADVISORY, never detections: the standard provider APIs do not expose a
 * model's real context window, vision or reasoning-effort support, so nothing here
 * is probed. The wizard labels every prefilled value as a suggestion the admin can
 * override, and an unknown id yields an empty suggestion to be declared by hand.
 *
 * A row is only added for a fact the vendor documents plainly. Field names mirror
 * the wire contract, so a suggestion can be spread straight into a
 * `ManagedModelInput`. Window subsets only ever list sizes the wizard can offer —
 * `CONTEXT_WINDOW_OPTIONS` (200K / 400K / 1M) — so a model whose real window is
 * unrepresentable (128K, 64K) simply declares none.
 */
export interface CapabilitySuggestion {
  supported_context_windows?: number[];
  supported_reasoning_efforts?: ReasoningEffortLevel[];
  reasoning_effort?: ReasoningEffortLevel;
  supports_vision?: boolean;
  supports_thinking?: boolean;
}

const ALL_EFFORTS: ReasoningEffortLevel[] = ["minimal", "low", "medium", "high"];
const EFFORTS_WITHOUT_MINIMAL: ReasoningEffortLevel[] = [
  "low",
  "medium",
  "high",
];

/** First match wins; keep more specific patterns above the broader ones. */
const RULES: ReadonlyArray<{
  pattern: RegExp;
  suggestion: CapabilitySuggestion;
}> = [
  {
    // Anthropic's API takes a thinking budget rather than OpenAI-style effort
    // levels, so no effort subset is claimed here.
    pattern: /^claude/,
    suggestion: {
      supported_context_windows: [200_000],
      supports_vision: true,
      supports_thinking: true,
    },
  },
  {
    // GPT-5 is where `minimal` entered OpenAI's reasoning-effort set.
    pattern: /^gpt-5/,
    suggestion: {
      supported_context_windows: [400_000],
      supported_reasoning_efforts: ALL_EFFORTS,
      reasoning_effort: "medium",
      supports_vision: true,
    },
  },
  {
    pattern: /^gpt-4\.1/,
    suggestion: {
      supported_context_windows: [1_000_000],
      supports_vision: true,
    },
  },
  {
    // 128K — no matching window option, so only the vision fact is claimed.
    pattern: /^gpt-4o|^gpt-4-turbo/,
    suggestion: { supports_vision: true },
  },
  {
    // o-series reasoning models predate `minimal`.
    pattern: /^o[134]/,
    suggestion: {
      supported_context_windows: [200_000],
      supported_reasoning_efforts: EFFORTS_WITHOUT_MINIMAL,
      reasoning_effort: "medium",
    },
  },
  {
    pattern: /^deepseek-(reasoner|r1)/,
    suggestion: { supports_thinking: true, supports_vision: false },
  },
  {
    pattern: /^deepseek-(chat|v3)/,
    suggestion: { supports_thinking: false, supports_vision: false },
  },
];

/** Suggest capabilities for a model id; `{}` when the id is not curated. */
export function suggestCapabilities(modelId: string): CapabilitySuggestion {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return {};
  const rule = RULES.find(({ pattern }) => pattern.test(normalized));
  return rule ? cloneSuggestion(rule.suggestion) : {};
}

/** Copy the shared table out, so a caller editing the result cannot poison it. */
function cloneSuggestion(suggestion: CapabilitySuggestion): CapabilitySuggestion {
  return {
    ...suggestion,
    supported_context_windows: suggestion.supported_context_windows
      ? [...suggestion.supported_context_windows]
      : undefined,
    supported_reasoning_efforts: suggestion.supported_reasoning_efforts
      ? [...suggestion.supported_reasoning_efforts]
      : undefined,
  };
}
