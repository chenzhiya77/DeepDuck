"use client";

import type { CSSProperties } from "react";

import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { effectiveFps, resolveSprite, type PetManifest } from "@/core/pet/sprite";
import type { PetState } from "@/core/pet/state";

export interface PetSpriteProps {
  state: PetState;
  manifest: PetManifest;
  /** 一次性态播完(`animationend`)时触发,由上层清掉 `oneShot` 回到 base */
  onOneShotEnd?: () => void;
}

/** 恒为偶数 CSS px:帧宽在设备像素上对齐,防右缘露出邻帧的亚像素鬼影(spec §10) */
function evenBoxSize(displaySize: number): number {
  return 2 * Math.round(displaySize / 2);
}

/**
 * 只吃 `PetState` + manifest 的渲染器,不知道 agent 的存在(spec §4.1)。
 * 播放是纯 CSS:横向单行 sheet 由 `background-position` + `steps(N, jump-none)`
 * 走完,一次性态靠 `animationend` 交回上层 —— 不引任何动画库(spec §9.1)。
 */
export function PetSprite({ state, manifest, onOneShotEnd }: PetSpriteProps) {
  const reducedMotion = usePrefersReducedMotion();
  const sprite = resolveSprite(state, manifest);

  // 资产缺失/解析不到 → 不渲染任何节点(spec §11)
  if (!sprite) return null;

  const entry = manifest.states[sprite]!;
  const fps = effectiveFps(sprite, state, manifest);
  const size = evenBoxSize(manifest.displaySize);

  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url(/pet/parrot/${sprite}.webp)`,
    backgroundSize: `${entry.frames * 100}% 100%`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0% 0",
  };

  if (!reducedMotion) {
    // 减弱动效时干脆不给 animation:停在第 0 帧,单套资产够用(spec §9.1)
    style.animation = `pet-play ${entry.frames / fps}s steps(${entry.frames}, jump-none) ${
      entry.loop ? "infinite" : "1"
    } both`;
  }

  return (
    <div
      aria-hidden="true"
      className="pet-sprite pointer-events-none"
      onAnimationEnd={onOneShotEnd}
      style={style}
    />
  );
}
