import { pickWorkKind } from "./tools";

export const PET_BASE_STATES = ["idle", "think", "work", "wait", "error"] as const;
export type PetBaseState = (typeof PET_BASE_STATES)[number];

export const PET_WORK_KINDS = [
  "exec",
  "read",
  "write",
  "browse",
  "recall",
  "delegate",
  "generic",
] as const;
export type PetWorkKind = (typeof PET_WORK_KINDS)[number];

export const PET_ONE_SHOTS = ["greet", "done"] as const;
export type PetOneShot = (typeof PET_ONE_SHOTS)[number];

export type FatigueLevel = 0 | 1 | 2 | 3;

export interface PetSignals {
  isLoading: boolean;
  wasLoading: boolean;
  hasError: boolean;
  hasOpenHumanInputRequest: boolean;
  /**
   * 全部在飞工具名,可为多个 —— 支持并行工具调用,空数组 = 无工具在飞。
   */
  activeToolNames: string[];
  fatigue: FatigueLevel;
}

export interface PetState {
  base: PetBaseState;
  workKind: PetWorkKind | null;
  fatigue: FatigueLevel;
  oneShot: PetOneShot | null;
}

/**
 * 顶层优先级与 `page.tsx` 的 `ChatStatus` 同构:`error > isLoading > ready`。
 * `greet` 不进纯函数 —— 它是挂载生命周期,由 `agent-pet.tsx` 触发一次。
 */
export function derivePetState(s: PetSignals): PetState {
  if (s.hasError) {
    return { base: "error", workKind: null, fatigue: s.fatigue, oneShot: null };
  }
  if (s.isLoading) {
    const kind = pickWorkKind(s.activeToolNames);
    return {
      base: kind ? "work" : "think",
      workKind: kind,
      fatigue: s.fatigue,
      oneShot: null,
    };
  }
  if (s.hasOpenHumanInputRequest) {
    return { base: "wait", workKind: null, fatigue: s.fatigue, oneShot: null };
  }
  return {
    base: "idle",
    workKind: null,
    fatigue: s.fatigue,
    oneShot: s.wasLoading ? "done" : null,
  };
}
