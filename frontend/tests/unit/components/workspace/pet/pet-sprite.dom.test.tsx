import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import { PetSprite } from "@/components/workspace/pet/pet-sprite";
import type { PetManifest } from "@/core/pet/sprite";
import type { PetState } from "@/core/pet/state";

function petState(overrides: Partial<PetState> = {}): PetState {
  return {
    base: "idle",
    workKind: null,
    fatigue: 0,
    oneShot: null,
    ...overrides,
  };
}

function entry(fps: number, loop: boolean) {
  return { frames: 4, fps, loop, sheetWidth: 2048, sheetHeight: 512 };
}

const manifest: PetManifest = {
  frameWidth: 512,
  frameHeight: 512,
  displaySize: 96,
  fallback: "idle",
  states: {
    idle: entry(8, true),
    think: entry(8, true),
    wait: entry(8, true),
    error: entry(8, true),
    // 只给「宽限期」那条用例用:它的 URL 没被别的用例暖过,
    // 否则模块级 warmCache 会把上一条的失败结果喂给这一条
    greet: entry(8, true),
    done: entry(24, false),
  },
};

const originalMatchMedia = window.matchMedia;
const originalImage = window.Image;

/**
 * 预热用的 `<img>` 换成可手动了断的假件,用来精确控制「新的 sheet 解码好了没」。
 * 真跑起来时这里是一次真实的 webp 解码,测试里点不着那个时机。
 */
let decodeSettlers: ((ok: boolean) => void)[] = [];
let requestedUrls: string[] = [];
/** 解码的默认行为:pending = 永不 settle(页面不可见时真会这样) */
let decodeMode: "pending" | "ok" | "fail" = "pending";

class FakeImage {
  assignedSrc = "";
  listeners: Record<string, ((event?: unknown) => void)[]> = {};

  set src(value: string) {
    this.assignedSrc = value;
    requestedUrls.push(value);
    // 同步推进到「字节到齐、等 decode」—— 测试不需要模拟网络延迟
    (this.listeners.load ?? []).forEach((fn) => fn());
  }

  get src(): string {
    return this.assignedSrc;
  }

  addEventListener(type: string, fn: (event?: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  decode(): Promise<void> {
    if (decodeMode === "ok") return Promise.resolve();
    if (decodeMode === "fail") {
      return Promise.reject(new Error("decode failed"));
    }
    return new Promise<void>((resolve, reject) => {
      decodeSettlers.push((ok) =>
        ok ? resolve() : reject(new Error("decode failed")),
      );
    });
  }
}

/** 让所有在等的解码一次性了断 */
function settleDecode(ok: boolean) {
  const settlers = decodeSettlers;
  decodeSettlers = [];
  settlers.forEach((settle) => settle(ok));
}

function stubReducedMotion(matches: boolean) {
  window.matchMedia = rs.fn().mockImplementation(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function spriteBox(container: HTMLElement): HTMLElement {
  const box = container.firstElementChild;
  if (!(box instanceof HTMLElement)) {
    throw new Error("PetSprite rendered no element");
  }
  return box;
}

beforeEach(() => {
  decodeSettlers = [];
  requestedUrls = [];
  decodeMode = "pending";
  window.Image = FakeImage as unknown as typeof Image;
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  window.Image = originalImage;
});

describe("PetSprite motion preference", () => {
  it("holds the first frame with no animation under reduced motion", () => {
    stubReducedMotion(true);
    const { container } = render(<PetSprite state={petState()} manifest={manifest} />);
    const box = spriteBox(container);

    expect(box.style.animation).toBe("");
    // happy-dom serializes the vertical half as "0px", so pin the horizontal
    // position (frame 0) rather than the exact string.
    expect(box.style.backgroundPosition).toMatch(/^0%/);
    expect(box.style.width).toBe("96px");
    expect(box.style.height).toBe("96px");
  });

  // Without this half, the assertion above would also pass if the component
  // simply never animated anything.
  it("plays the state's steps() animation when motion is allowed", () => {
    stubReducedMotion(false);
    const { container } = render(<PetSprite state={petState()} manifest={manifest} />);
    const box = spriteBox(container);

    expect(box.style.animation).toContain("steps(4, jump-none)");
    expect(box.style.animation).toContain("0.5s");
    expect(box.style.animation).toContain("infinite");
    expect(box.style.backgroundImage).toContain("idle.webp");
  });
});

describe("PetSprite one-shot", () => {
  it("fires onOneShotEnd when the one-shot finishes, then returns to base", async () => {
    stubReducedMotion(false);
    const onOneShotEnd = rs.fn();
    const { container, rerender } = render(
      <PetSprite
        state={petState({ base: "wait", oneShot: "done" })}
        manifest={manifest}
        onOneShotEnd={onOneShotEnd}
      />,
    );
    const box = spriteBox(container);

    expect(box.style.backgroundImage).toContain("done.webp");
    expect(box.style.animation).not.toContain("infinite");

    fireEvent.animationEnd(box);
    expect(onOneShotEnd).toHaveBeenCalledTimes(1);

    rerender(
      <PetSprite state={petState({ base: "wait" })} manifest={manifest} />,
    );
    // 换 sheet 要等解码,不等就换会空一拍(见下面「state switch」那组)
    await act(async () => settleDecode(true));
    expect(spriteBox(container).style.backgroundImage).toContain("wait.webp");
  });
});

describe("PetSprite state switch", () => {
  it("keeps painting the previous sheet until the new one has decoded", async () => {
    stubReducedMotion(false);
    const { container, rerender } = render(
      <PetSprite state={petState()} manifest={manifest} />,
    );
    const box = spriteBox(container);
    expect(box.style.backgroundImage).toContain("idle.webp");

    rerender(<PetSprite state={petState({ base: "think" })} manifest={manifest} />);

    // 这就是缺陷本身:解码没完成时若已经换了 background-image,那一格没有像素,
    // 宠物会先消失一下再出现。所以这里必须**还是旧的那张**。
    expect(box.style.backgroundImage).toContain("idle.webp");
    expect(requestedUrls.some((url) => url.includes("think.webp"))).toBe(true);

    await act(async () => settleDecode(true));
    expect(spriteBox(container).style.backgroundImage).toContain("think.webp");
  });

  it("keeps the previous sheet when the new one fails to decode", async () => {
    stubReducedMotion(false);
    const { container, rerender } = render(
      <PetSprite state={petState()} manifest={manifest} />,
    );
    const box = spriteBox(container);

    rerender(<PetSprite state={petState({ base: "error" })} manifest={manifest} />);
    await act(async () => settleDecode(false));

    // 换上去是空白,留着旧的至少还是一只鸟
    expect(box.style.backgroundImage).toContain("idle.webp");
    expect(box.style.animation).toContain("infinite");
  });

  it("decode 永不 settle ⇒ 过了宽限期照样换图", async () => {
    stubReducedMotion(false);
    const { container, rerender } = render(
      <PetSprite state={petState()} manifest={manifest} />,
    );
    const box = spriteBox(container);

    // 页面被判为不可见时 Chrome 会推迟解码:既不 resolve 也不 reject。
    // 这里就是那个情形 —— 一次都不调用 settleDecode。
    rerender(<PetSprite state={petState({ oneShot: "greet" })} manifest={manifest} />);
    expect(box.style.backgroundImage).toContain("idle.webp");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // 字节已经到齐,只是解码没动静 —— 不能因此把换图永久扣住
    expect(spriteBox(container).style.backgroundImage).toContain("greet.webp");
  });
});

describe("PetSprite with nothing to draw", () => {
  it("renders no node when the manifest cannot resolve a sprite", () => {
    stubReducedMotion(false);
    const empty: PetManifest = {
      ...manifest,
      fallback: "missing",
      states: { think: entry(8, true) },
    };

    const { container } = render(
      <PetSprite state={petState({ base: "wait" })} manifest={empty} />,
    );

    expect(container.firstElementChild).toBeNull();
  });
});
