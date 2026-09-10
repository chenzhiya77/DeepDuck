import type { PetState } from "./state";

export interface PetSpriteEntry {
  frames: number;
  fps: number;
  loop: boolean;
  /** 由抽帧脚本写出,供 §8 的 manifest 自校验(node 测试)使用 */
  sheetWidth: number;
  sheetHeight: number;
}

export interface PetManifest {
  frameWidth: number;
  frameHeight: number;
  displaySize: number;
  /** `idle` 必需、其余全部可选(§8 规则 1);缺失一律回落到它 */
  fallback: string;
  states: Record<string, PetSpriteEntry>;
}

/**
 * 两级回落:`work-{kind}` → `work` → `fallback`(§9.2)。
 * 它是 §8 规则 1 的自然延伸,使 §6 的六个 workKind **全部可选**。
 */
export function resolveSprite(state: PetState, manifest: PetManifest): string | null {
  const oneShot = state.oneShot ? [state.oneShot] : [];
  const base =
    state.base === "work" && state.workKind
      ? [`work-${state.workKind}`, "work"]
      : [state.base];
  return [...oneShot, ...base, manifest.fallback].find((c) => c in manifest.states) ?? null;
}

export const FATIGUE_FPS_SCALE = [1, 0.9, 0.75, 0.6] as const;

export function effectiveFps(
  sprite: string,
  state: PetState,
  manifest: PetManifest,
): number {
  // 调用方只会传 `resolveSprite` 的产物,而它返回的键必然存在于 states 中。
  const entry = manifest.states[sprite]!;
  // 一次性动画不衰减:done 是信息,必须读得清
  return entry.loop ? entry.fps * FATIGUE_FPS_SCALE[state.fatigue] : entry.fps;
}
