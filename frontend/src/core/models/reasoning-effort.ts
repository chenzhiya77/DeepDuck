import { REASONING_EFFORT_LEVELS } from "./api";
import type { ReasoningEffortLevel } from "./types";

/**
 * Composer mode + reasoning-depth rules (spec 2026-09-10 §5.3.2 / §6, option A).
 *
 * The rules live here because three surfaces share them: the input box, the sidecar
 * panel and the send path in `core/threads/hooks.ts`. Keeping the gating and the
 * resolution order in one tested place is what stops a menu from offering a choice
 * the model cannot serve, or from snapping back after it is picked.
 */

/** Composer modes. Only `flash` works on a model without thinking support. */
export type InputMode = "flash" | "thinking" | "pro" | "ultra";

export const INPUT_MODES: readonly InputMode[] = ["flash", "thinking", "pro", "ultra"];

/** The part of a model's payload these rules read. */
export interface ReasoningEffortSource {
  /** Default level used when the caller picks none. */
  reasoning_effort?: ReasoningEffortLevel | null;
  /** Declared level subset; null/undefined = undeclared (all levels apply). */
  supported_reasoning_efforts?: readonly ReasoningEffortLevel[] | null;
}

/** Whether a mode can be selected for a model (flash needs nothing). */
export function isModeOffered(
  mode: InputMode,
  supportsThinking: boolean,
): boolean {
  return mode === "flash" || supportsThinking;
}

/** The modes a model can actually run, in menu order. */
export function offeredModes(supportsThinking: boolean): InputMode[] {
  return INPUT_MODES.filter((mode) => isModeOffered(mode, supportsThinking));
}

/**
 * Fall back to the mode the model can run, then to its default (`pro` for a
 * thinking model, `flash` otherwise). The fallback keeps a stale stored mode from
 * rendering a choice the runtime would silently discard.
 */
export function resolveMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
): InputMode {
  if (!supportsThinking && mode !== "flash") {
    return "flash";
  }
  if (mode) {
    return mode;
  }
  return supportsThinking ? "pro" : "flash";
}

/** Levels the depth selector offers: the declared subset, else every level. */
export function reasoningEffortLevels(
  model: ReasoningEffortSource | undefined,
): ReasoningEffortLevel[] {
  const declared = model?.supported_reasoning_efforts;
  return declared && declared.length > 0
    ? [...declared]
    : [...REASONING_EFFORT_LEVELS];
}

/**
 * The model's declared default, only while it is one of the offered levels. The
 * config validator already enforces membership; this keeps the UI honest for
 * payloads that never went through it.
 */
export function modelDefaultEffort(
  model: ReasoningEffortSource | undefined,
): ReasoningEffortLevel | undefined {
  const declared = model?.reasoning_effort ?? undefined;
  return declared && reasoningEffortLevels(model).includes(declared)
    ? declared
    : undefined;
}

/**
 * The pre-subset mode heuristic, kept as the last ring for models that declare no
 * default level.
 */
export function modeHeuristicEffort(
  mode: InputMode | undefined,
): ReasoningEffortLevel | undefined {
  switch (mode) {
    case "ultra":
      return "high";
    case "pro":
      return "medium";
    case "thinking":
      return "low";
    default:
      return undefined;
  }
}

/**
 * Option A resolution order: explicit selection > model default > mode heuristic.
 *
 * `explicit` is the composer context's own value, which the input box preselects
 * from the model default when a model is chosen — so a user's pick always wins and
 * a model-declared level is never silently replaced by the mode.
 */
export function resolveReasoningEffort({
  explicit,
  model,
  mode,
}: {
  explicit?: ReasoningEffortLevel;
  model?: ReasoningEffortSource;
  mode?: InputMode;
}): ReasoningEffortLevel | undefined {
  return explicit ?? modelDefaultEffort(model) ?? modeHeuristicEffort(mode);
}

/**
 * Selecting a model preselects that model's declared default; without one the
 * current value stands (it may be the user's own pick).
 */
export function effortAfterModelSelect(
  current: ReasoningEffortLevel | undefined,
  model: ReasoningEffortSource | undefined,
): ReasoningEffortLevel | undefined {
  return modelDefaultEffort(model) ?? current;
}

/**
 * Switching mode keeps the current level while the model declares a default (its
 * level is authoritative, so `ultra` no longer forces `high`); without one the
 * legacy mode heuristic still applies.
 */
export function effortAfterModeSelect(
  current: ReasoningEffortLevel | undefined,
  model: ReasoningEffortSource | undefined,
  mode: InputMode,
): ReasoningEffortLevel | undefined {
  return modelDefaultEffort(model) !== undefined
    ? current
    : modeHeuristicEffort(mode);
}
