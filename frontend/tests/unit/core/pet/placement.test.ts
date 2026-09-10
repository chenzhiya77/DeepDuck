import { describe, expect, it } from "@rstest/core";

import { clampOffset } from "@/core/pet/placement";
import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings/local";

const BOX = { size: 96 };
const PANEL = { width: 800, height: 600 };

describe("clampOffset", () => {
  it("leaves an offset that already fits untouched", () => {
    expect(clampOffset({ right: 12, top: 56 }, BOX, PANEL)).toEqual({
      right: 12,
      top: 56,
    });
  });

  it("pulls the box back inside when it hangs off the right edge", () => {
    expect(clampOffset({ right: 900, top: 56 }, BOX, PANEL)).toEqual({
      right: PANEL.width - BOX.size,
      top: 56,
    });
  });

  it("pulls the box back inside when it hangs off the bottom edge", () => {
    expect(clampOffset({ right: 12, top: 900 }, BOX, PANEL)).toEqual({
      right: 12,
      top: PANEL.height - BOX.size,
    });
  });

  it("keeps a dragged-past-the-corner offset inside the panel", () => {
    expect(clampOffset({ right: -40, top: -10 }, BOX, PANEL)).toEqual({
      right: 0,
      top: 0,
    });
  });

  it("pins to the corner when the panel is smaller than the box", () => {
    const tiny = { width: 80, height: 80 };

    expect(clampOffset({ right: 12, top: 56 }, BOX, tiny)).toEqual({
      right: 0,
      top: 0,
    });
  });

  it("never returns a negative offset", () => {
    const { right, top } = clampOffset({ right: 5, top: 5 }, BOX, {
      width: 96,
      height: 96,
    });

    expect(right).toBe(0);
    expect(top).toBe(0);
  });
});

describe("default pet placement", () => {
  it("ships the right-3 top-14 anchor so an unplaced user sees no change", () => {
    expect(DEFAULT_LOCAL_SETTINGS.pet.offset).toEqual({ right: 12, top: 56 });
  });

  it("defaults the pet to on", () => {
    expect(DEFAULT_LOCAL_SETTINGS.pet.enabled).toBe(true);
  });
});
