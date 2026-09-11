"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { evenBoxSize } from "@/core/pet/placement";
import { effectiveFps, resolveSprite, type PetManifest } from "@/core/pet/sprite";
import type { PetState } from "@/core/pet/state";

export interface PetSpriteProps {
  state: PetState;
  manifest: PetManifest;
  /** 盒子边长(CSS px,恒偶数)。省略时退回 `manifest.displaySize`(§8 的占比补偿值) */
  size?: number;
  /** 一次性态播完(`animationend`)时触发,由上层清掉 `oneShot` 回到 base */
  onOneShotEnd?: () => void;
}

const spriteUrl = (sprite: string) => `/pet/parrot/${sprite}.webp`;

interface WarmSprite {
  img: HTMLImageElement;
  ready: Promise<boolean>;
}

/**
 * 每张 sheet 只预热一次,并**持有 `<img>` 的强引用** —— 这一点是修缺陷的关键,
 * 不是随手缓存:换 `background-image` 时浏览器得现解码 7.5 Mpx(15360×512,
 * 解码后约 31 MB),解完之前那一格没有像素,表现就是切状态时宠物先消失一下。
 * 同一 URL 的解码结果留在内存里,换过去的那一刻才有像素可画;引用一松数据
 * 被回收,预热就等于没做。
 */
const warmCache = new Map<string, WarmSprite>();

/** @returns true = 已解码、可以画;false = 加载或解码失败 */
function warmSprite(url: string): Promise<boolean> {
  const cached = warmCache.get(url);
  if (cached) return cached.ready;

  const img = new Image();
  img.src = url;
  const ready =
    typeof img.decode === "function"
      ? img.decode().then(
          () => true,
          () => false,
        )
      : new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
        });
  warmCache.set(url, { img, ready });
  return ready;
}

/**
 * 只吃 `PetState` + manifest 的渲染器,不知道 agent 的存在(spec §4.1)。
 * 播放是纯 CSS:横向单行 sheet 由 `background-position` + `steps(N, jump-none)`
 * 走完,一次性态靠 `animationend` 交回上层 —— 不引任何动画库(spec §9.1)。
 *
 * `painted` **故意慢于 `state`**:新的 sheet 解码好之前不换 `background-image`,
 * 于是切换状态时旧的那张一直在画,不会先消失再出现(2026-09-11 实测缺陷)。
 * 首帧没有旧图可留,所以直接画 —— 只有「换」才值得等。
 */
export function PetSprite({
  state,
  manifest,
  size: sizeProp,
  onOneShotEnd,
}: PetSpriteProps) {
  const reducedMotion = usePrefersReducedMotion();
  const sprite = resolveSprite(state, manifest);
  const [painted, setPainted] = useState<string | null>(sprite);

  useEffect(() => {
    if (!sprite || sprite === painted) return;
    let cancelled = false;
    void warmSprite(spriteUrl(sprite)).then((decoded) => {
      // 解码失败就不换:换上去了是空白,留着旧的至少还是一只鸟
      if (!cancelled && decoded) setPainted(sprite);
    });
    return () => {
      cancelled = true;
    };
  }, [sprite, painted]);

  // 资产缺失/解析不到 → 不渲染任何节点(spec §11)
  if (!sprite || !painted) return null;

  const entry = manifest.states[painted]!;
  const fps = effectiveFps(painted, state, manifest);
  // 尺寸的唯一来源是调用方(它读用户设置);manifest 的 displaySize 只是默认值
  const size = sizeProp ?? evenBoxSize(manifest.displaySize);

  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url(${spriteUrl(painted)})`,
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
