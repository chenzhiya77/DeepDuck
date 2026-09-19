import { REASONING_EFFORT_LEVELS } from "./api";
import type { CapabilitySuggestion } from "./capability-registry";
import type {
  ManagedModel,
  ManagedModelInput,
  ReasoningEffortLevel,
} from "./types";

/**
 * Capability value model (spec 2026-09-10 §5.4).
 *
 * One shape is edited by both the add wizard's step 2 and the edit dialog, and it
 * is also what `expandBatchToEntries` consumes. The rules that keep it legal live
 * here so the editor, the batch expansion and the single-model save cannot drift:
 * a declared subset drops a default outside it, and a subset is "undeclared"
 * rather than empty when nothing is selected.
 */
export interface ModelCapabilityValue {
  supportsThinking: boolean;
  supportsVision: boolean;
  /** Selected window sizes, ascending; empty = subset not declared. */
  supportedWindows: number[];
  /** Default window; kept only while it stays a member of `supportedWindows`. */
  defaultWindow?: number;
  /** Selected effort levels, enum order; empty = subset not declared. */
  supportedEfforts: ReasoningEffortLevel[];
  /** Default effort; kept only while it stays a member of `supportedEfforts`. */
  defaultEffort?: ReasoningEffortLevel;
}

/**
 * The capability half of a shared credential block. `BatchSharedFields` extends
 * this, so the wizard passes its editor value straight into the expansion.
 *
 * `defaultWindow` / `defaultEffort` are the ONE canonical default per axis: they
 * stand alone while no subset is declared (the legacy single-value shape) and are
 * gated by subset membership once one is.
 */
export interface CapabilitySharedFields {
  supportsThinking?: boolean;
  supportsVision?: boolean;
  supportsReasoningEffort?: boolean;
  supportedWindows?: number[];
  defaultWindow?: number;
  supportedEfforts?: ReasoningEffortLevel[];
  defaultEffort?: ReasoningEffortLevel;
}

export type CapabilityWireFields = Pick<
  ManagedModelInput,
  | "supports_thinking"
  | "supports_vision"
  | "supports_reasoning_effort"
  | "supported_context_windows"
  | "context_window"
  | "supported_reasoning_efforts"
  | "reasoning_effort"
>;

export function emptyCapabilityValue(): ModelCapabilityValue {
  return {
    supportsThinking: false,
    supportsVision: false,
    supportedWindows: [],
    supportedEfforts: [],
  };
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

/** Keep a still-valid default, adopt a lone option, otherwise ask the user. */
function nextDefault<T>(
  previous: T | undefined,
  subset: readonly T[],
): T | undefined {
  if (previous !== undefined && subset.includes(previous)) return previous;
  return subset.length === 1 ? subset[0] : undefined;
}

export function toggleWindow(
  value: ModelCapabilityValue,
  size: number,
): ModelCapabilityValue {
  const supportedWindows = value.supportedWindows.includes(size)
    ? value.supportedWindows.filter((option) => option !== size)
    : [...value.supportedWindows, size].sort((a, b) => a - b);
  return {
    ...value,
    supportedWindows,
    defaultWindow: nextDefault(value.defaultWindow, supportedWindows),
  };
}

export function toggleEffort(
  value: ModelCapabilityValue,
  level: ReasoningEffortLevel,
): ModelCapabilityValue {
  const supportedEfforts = REASONING_EFFORT_LEVELS.filter((candidate) =>
    candidate === level
      ? !value.supportedEfforts.includes(level)
      : value.supportedEfforts.includes(candidate),
  );
  return {
    ...value,
    supportedEfforts,
    defaultEffort: nextDefault(value.defaultEffort, supportedEfforts),
  };
}

export function capabilityValueFromModel(
  model: ManagedModel,
): ModelCapabilityValue {
  const declaredEfforts = model.supported_reasoning_efforts ?? [];
  return {
    supportsThinking: Boolean(model.supports_thinking),
    supportsVision: Boolean(model.supports_vision),
    supportedWindows: [...(model.supported_context_windows ?? [])],
    defaultWindow: model.context_window ?? undefined,
    // Legacy rows carry only the boolean. Showing every level it implies lets the
    // admin confirm and re-declare it, instead of the editor looking unsupported.
    supportedEfforts:
      declaredEfforts.length > 0
        ? [...declaredEfforts]
        : model.supports_reasoning_effort
          ? [...REASONING_EFFORT_LEVELS]
          : [],
    defaultEffort: model.reasoning_effort ?? undefined,
  };
}

export function capabilityValueFromSuggestion(
  suggestion: CapabilitySuggestion,
): ModelCapabilityValue {
  const supportedWindows = [...(suggestion.supported_context_windows ?? [])];
  const supportedEfforts = [...(suggestion.supported_reasoning_efforts ?? [])];
  const suggestedEffort = suggestion.reasoning_effort;
  return {
    supportsThinking: Boolean(suggestion.supports_thinking),
    supportsVision: Boolean(suggestion.supports_vision),
    supportedWindows,
    // A suggestion names no default window, so only an unambiguous one is adopted.
    defaultWindow: supportedWindows.length === 1 ? supportedWindows[0] : undefined,
    supportedEfforts,
    defaultEffort:
      suggestedEffort && supportedEfforts.includes(suggestedEffort)
        ? suggestedEffort
        : nextDefault(undefined, supportedEfforts),
  };
}

export function capabilityValueToShared(
  value: ModelCapabilityValue,
): CapabilitySharedFields {
  return {
    supportsThinking: value.supportsThinking,
    supportsVision: value.supportsVision,
    // The wire flag is exactly "a subset is declared": the editor has no separate
    // effort toggle, so the two can never disagree.
    supportsReasoningEffort: value.supportedEfforts.length > 0,
    supportedWindows: declaredSubset(value.supportedWindows),
    defaultWindow: value.defaultWindow,
    supportedEfforts: declaredSubset(value.supportedEfforts),
    defaultEffort: value.defaultEffort,
  };
}

export function capabilityFieldsFromShared(
  shared: CapabilitySharedFields,
): Pick<
  CapabilityWireFields,
  | "supported_context_windows"
  | "context_window"
  | "supported_reasoning_efforts"
  | "reasoning_effort"
> {
  const windows = declaredSubset(shared.supportedWindows);
  const efforts = declaredSubset(shared.supportedEfforts);
  return {
    supported_context_windows: windows,
    // With no declared subset the single default stands as-is (the legacy shape);
    // with one, a default outside it would be rejected by the backend.
    context_window: windows
      ? gatedDefault(shared.defaultWindow, windows)
      : shared.defaultWindow,
    supported_reasoning_efforts: efforts,
    reasoning_effort: efforts
      ? gatedDefault(shared.defaultEffort, efforts)
      : shared.defaultEffort,
  };
}

/** Every capability wire field for one model, straight from an edited value. */
export function capabilityInputFromValue(
  value: ModelCapabilityValue,
): CapabilityWireFields {
  return {
    supports_thinking: value.supportsThinking,
    supports_vision: value.supportsVision,
    // Derived, never an independent toggle: a declared subset *is* the flag.
    supports_reasoning_effort: value.supportedEfforts.length > 0,
    ...capabilityFieldsFromShared(capabilityValueToShared(value)),
  };
}
