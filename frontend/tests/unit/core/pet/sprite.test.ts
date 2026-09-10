import { describe, expect, test } from "@rstest/core";

import {
  FATIGUE_FPS_SCALE,
  effectiveFps,
  resolveSprite,
  type PetManifest,
} from "@/core/pet/sprite";
import type { PetState } from "@/core/pet/state";

import parrotManifest from "../../../../public/pet/parrot/manifest.json";

function state(overrides: Partial<PetState> = {}): PetState {
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

/** Fixture only — the real manifest arrives with Task 3 and is asserted there. */
function manifest(states: Record<string, ReturnType<typeof entry>>, fallback = "idle"): PetManifest {
  return {
    frameWidth: 512,
    frameHeight: 512,
    displaySize: 96,
    fallback,
    states,
  };
}

describe("resolveSprite", () => {
  const full = manifest({
    idle: entry(8, true),
    work: entry(8, true),
    "work-read": entry(8, true),
    wait: entry(8, true),
    done: entry(24, false),
  });

  test("prefers the work sub-kind sprite", () => {
    expect(resolveSprite(state({ base: "work", workKind: "read" }), full)).toBe(
      "work-read",
    );
  });

  test("falls back to the plain work sprite when the sub-kind is not drawn", () => {
    const withoutSubKind = manifest({
      idle: entry(8, true),
      work: entry(8, true),
    });

    expect(resolveSprite(state({ base: "work", workKind: "read" }), withoutSubKind)).toBe(
      "work",
    );
  });

  test("falls back to the declared fallback when neither work sprite exists", () => {
    const idleOnly = manifest({ idle: entry(8, true) });

    expect(resolveSprite(state({ base: "work", workKind: "read" }), idleOnly)).toBe(
      "idle",
    );
  });

  test("falls back to the declared fallback for a missing base state", () => {
    const withoutWait = manifest({ idle: entry(8, true) });

    expect(resolveSprite(state({ base: "wait" }), withoutWait)).toBe("idle");
  });

  test("treats a work base with no sub-kind as the plain work sprite", () => {
    expect(resolveSprite(state({ base: "work", workKind: null }), full)).toBe("work");
  });

  test("lets a one-shot win over the base state", () => {
    expect(resolveSprite(state({ base: "wait", oneShot: "done" }), full)).toBe("done");
  });

  test("falls back to the base state when the one-shot is not drawn", () => {
    expect(resolveSprite(state({ base: "wait", oneShot: "greet" }), full)).toBe("wait");
  });

  test("returns null when nothing in the manifest matches", () => {
    const nothingUseful = manifest({ think: entry(8, true) }, "greet");

    expect(resolveSprite(state({ base: "wait" }), nothingUseful)).toBeNull();
    expect(resolveSprite(state(), nothingUseful)).toBeNull();
  });
});

describe("effectiveFps", () => {
  const loops = manifest({ idle: entry(8, true), done: entry(24, false) });

  test("scales a looping sprite down as fatigue rises", () => {
    for (const fatigue of [0, 1, 2, 3] as const) {
      expect(effectiveFps("idle", state({ fatigue }), loops)).toBe(
        8 * FATIGUE_FPS_SCALE[fatigue],
      );
    }
  });

  test("never slows a one-shot down — done is information", () => {
    for (const fatigue of [0, 1, 2, 3] as const) {
      expect(effectiveFps("done", state({ fatigue }), loops)).toBe(24);
    }
  });

  test("pins the scale table", () => {
    expect([...FATIGUE_FPS_SCALE]).toEqual([1, 0.9, 0.75, 0.6]);
  });
});

describe("parrot manifest self-consistency (spec §8)", () => {
  test("declares idle and makes the fallback reachable", () => {
    expect(parrotManifest.states.idle).toBeDefined();
    expect(parrotManifest.states[parrotManifest.fallback]).toBeDefined();
  });

  for (const [name, entry] of Object.entries(parrotManifest.states)) {
    test(`${name}: sheet width is frames x frameWidth`, () => {
      expect(entry.sheetWidth).toBe(entry.frames * parrotManifest.frameWidth);
    });

    test(`${name}: sheet height is frameHeight`, () => {
      expect(entry.sheetHeight).toBe(parrotManifest.frameHeight);
    });
  }
});
