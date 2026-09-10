import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render } from "@testing-library/react";

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
    wait: entry(8, true),
    done: entry(24, false),
  },
};

const originalMatchMedia = window.matchMedia;

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

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
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
  it("fires onOneShotEnd when the one-shot finishes, then returns to base", () => {
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
    expect(spriteBox(container).style.backgroundImage).toContain("wait.webp");
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
