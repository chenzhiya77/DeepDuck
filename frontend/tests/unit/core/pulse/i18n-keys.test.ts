import { describe, expect, it } from "@rstest/core";

import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import keyManifest from "@/core/pulse/pulse-i18n-keys.json";

import { checkLocaleAgainstManifest } from "../../support/i18n-key-manifest";

/**
 * Guard for the frozen `pulse.*` copy.
 *
 * Spec: docs/superpowers/specs/2026-09-13-harness-live-pulse-design.md §5.
 *
 * Two of the three machines this line usually wires are deliberately absent, and
 * both because the thing they would guard does not exist rather than because they
 * were skipped: there is no backend guard (nothing under `pulse.*` mirrors a
 * server-owned enum — the stage names come from the constitution's own frozen
 * table via the ring's `labelForStage`), and there is no accessible-name string
 * (the marker is decorative — `aria-hidden` — so the visible lap line is what a
 * screen reader reads; two strings saying the same thing would be one too many).
 */
const LAP_KEY = ["lap"];

const LOCALES = [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const;

describe("pulse i18n key manifest", () => {
  it("declares the lap line", () => {
    expect(keyManifest.keys).toEqual(LAP_KEY);
  });

  for (const [localeName, locale] of LOCALES) {
    it(`${localeName} covers every manifest key and nothing else`, () => {
      expect(
        checkLocaleAgainstManifest({
          namespace: "pulse",
          expectedPaths: keyManifest.keys,
          // The lap line takes the count.
          functionLeaves: keyManifest.keys,
          locale,
        }),
      ).toEqual({ missing: [], wrongType: [], orphans: [] });
    });
  }
});
