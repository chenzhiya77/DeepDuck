import { describe, expect, it } from "@rstest/core";

import {
  PET_DISPLAY_SIZE_MAX,
  PET_DISPLAY_SIZE_MIN,
  PET_DISPLAY_SIZE_SHARP_MAX,
  PET_DISPLAY_SIZE_SNAP_FROM,
  clampOffset,
  commitDisplaySize,
  evenBoxSize,
  normalizeDisplaySize,
} from "@/core/pet/placement";
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

  it("ships displaySize at the frame-share-compensated value", () => {
    // 帧装整个场景、鸟只占帧高 61.5%,故 158 是「期望鸟显示 ~96」补偿出来的(§8/§10.2)
    expect(DEFAULT_LOCAL_SETTINGS.pet.displaySize).toBe(158);
  });
});

describe("evenBoxSize / normalizeDisplaySize", () => {
  it("always returns an even edge(奇数取最近的偶数)", () => {
    expect(evenBoxSize(157)).toBe(158);
    expect(evenBoxSize(159)).toBe(160);
    expect(evenBoxSize(155)).toBe(156);
    expect(evenBoxSize(158)).toBe(158);
  });

  it("keeps every value in the sweep even", () => {
    for (
      let value = PET_DISPLAY_SIZE_MIN;
      value <= PET_DISPLAY_SIZE_MAX;
      value += 1
    ) {
      expect(normalizeDisplaySize(value) % 2).toBe(0);
    }
  });

  it("clamps into the 64–512 range", () => {
    expect(normalizeDisplaySize(0)).toBe(PET_DISPLAY_SIZE_MIN);
    expect(normalizeDisplaySize(-40)).toBe(PET_DISPLAY_SIZE_MIN);
    expect(normalizeDisplaySize(9999)).toBe(PET_DISPLAY_SIZE_MAX);
  });

  it("pins both ceilings to the numbers §10.2 derives them from", () => {
    // 512 = 帧像素数;它是刻意留 1.5× 插值余量的上界
    expect(PET_DISPLAY_SIZE_MAX).toBe(512);
    // 340 = 完全不插值的最后一个偶数盒子(帧 512 ÷ DPR 1.5 ≈ 341)
    expect(PET_DISPLAY_SIZE_SHARP_MAX).toBe(340);
    expect(PET_DISPLAY_SIZE_SHARP_MAX).toBeLessThan(PET_DISPLAY_SIZE_MAX);
  });

  it("falls back to the default for a stored value that is not a finite number", () => {
    // 旧 localStorage / 手改过的值都从这里收口,不把 NaN 传进盒子尺寸
    expect(normalizeDisplaySize(undefined)).toBe(158);
    expect(normalizeDisplaySize(null)).toBe(158);
    expect(normalizeDisplaySize(Number.NaN)).toBe(158);
    // 字符串不猜数字:直接回落默认(拿一个和默认不同的字符串才有区分力)
    expect(normalizeDisplaySize("200")).toBe(158);
  });

  it("snaps the step below the no-interpolation ceiling up onto it", () => {
    // 吸附点是「让用户能精确落在不插值边界上」,不是质量提示;它恒是上限的前一步(step 2)
    expect(PET_DISPLAY_SIZE_SHARP_MAX - PET_DISPLAY_SIZE_SNAP_FROM).toBe(2);
    expect(commitDisplaySize(338)).toBe(340);
    // 只有紧邻的那一步被吸;默认值与更远的中间值原样保留
    expect(commitDisplaySize(158)).toBe(158);
    expect(commitDisplaySize(336)).toBe(336);
  });

  it("still runs the normalizer before snapping", () => {
    expect(commitDisplaySize(9999)).toBe(PET_DISPLAY_SIZE_MAX);
    expect(commitDisplaySize("nope")).toBe(158);
  });

  it("clamps the box with the resized edge, not the old one", () => {
    // 缩放后要重跑 clamp:同一个 offset 在大盒子上会被拉回可见区
    const viewport = { width: 300, height: 300 };
    expect(clampOffset({ right: 12, top: 56 }, { size: 64 }, viewport)).toEqual(
      {
        right: 12,
        top: 56,
      },
    );
    expect(
      clampOffset({ right: 12, top: 56 }, { size: 256 }, viewport),
    ).toEqual({ right: 12, top: 300 - 256 });
  });
});
