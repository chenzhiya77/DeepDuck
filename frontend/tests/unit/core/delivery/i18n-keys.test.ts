import { describe, expect, it } from "@rstest/core";

import keyManifest from "@/core/delivery/delivery-i18n-keys.json";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";

import { checkLocaleAgainstManifest } from "../../support/i18n-key-manifest";

/**
 * Guard for the frozen `delivery.*` copy table.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §6.
 * The keys are the contract's `stage` enum verbatim (`presented` / `mismatched`
 * / `not_started`), so the sibling backend guard
 * (`backend/tests/test_delivery_i18n_keys.py`) can reconcile this list against
 * that enum with a plain set comparison — no snake/camel table to drift, which
 * is what the `guard`/`gate` wording split in the constitution line cost us.
 */
const STAGE_KEYS = ["presented", "mismatched", "not_started"];

const LOCALES = [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const;

describe("delivery i18n key manifest", () => {
  it("declares exactly the verdict's three states", () => {
    expect(keyManifest.stages).toEqual(STAGE_KEYS);
  });

  for (const [localeName, locale] of LOCALES) {
    it(`${localeName} covers every manifest key and nothing else`, () => {
      expect(
        checkLocaleAgainstManifest({
          namespace: "delivery",
          expectedPaths: keyManifest.stages,
          // Each entry takes counts and interpolates them.
          functionLeaves: keyManifest.stages,
          locale,
        }),
      ).toEqual({ missing: [], wrongType: [], orphans: [] });
    });
  }
});
