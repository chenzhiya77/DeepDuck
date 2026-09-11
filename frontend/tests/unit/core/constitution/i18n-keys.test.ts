import { describe, expect, it } from "@rstest/core";

import keyManifest from "@/core/constitution/constitution-i18n-keys.json";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";

import { checkLocaleAgainstManifest } from "../../support/i18n-key-manifest";

/**
 * Guard for the frozen `constitution.*` copy table.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §8.
 * The manifest is the checked-in key directory; the sibling backend guard
 * (`backend/tests/test_constitution_i18n_keys.py`) reads the same file to keep
 * the middleware names in step with `STAGE_OF_MIDDLEWARE`, so a renamed or
 * added middleware fails CI instead of silently rendering a bare class name.
 *
 * This file covers §8.2 guard 1 (both locales vs the manifest, both directions).
 * §8.2 guard 2 needs no separate test — see `tests/unit/support/i18n-key-manifest.ts`
 * for why `types.ts` is already covered by the compiler plus this walk.
 */
// a11y.segment / a11y.total take arguments, so they are functions rather than
// strings. Listing them explicitly means a third function key added later fails
// the string assertions instead of silently passing.
const FUNCTION_LEAVES = ["a11y.segment", "a11y.total"];

const LOCALES = [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const;

/** The manifest's nested shape, flattened to dotted paths in this namespace. */
function expectedPaths(): string[] {
  const paths: string[] = [];
  for (const [section, value] of Object.entries(keyManifest.core)) {
    if (value === true) {
      paths.push(section);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        paths.push(`${section}.${entry}`);
      }
    } else {
      throw new Error(`unexpected manifest shape at core.${section}`);
    }
  }
  for (const name of keyManifest.middlewares) {
    paths.push(`middleware.${name}`);
  }
  return paths;
}

describe("constitution i18n key manifest", () => {
  it("matches the frozen counts", () => {
    const coreCount = Object.values(keyManifest.core).reduce<number>(
      (sum, value) => sum + (Array.isArray(value) ? value.length : 1),
      0,
    );
    expect(coreCount).toBe(33);
    expect(keyManifest.middlewares.length).toBe(34);
    expect(expectedPaths().length).toBe(67);
  });

  for (const [localeName, locale] of LOCALES) {
    it(`${localeName} covers every manifest key and nothing else`, () => {
      expect(
        checkLocaleAgainstManifest({
          namespace: "constitution",
          expectedPaths: expectedPaths(),
          functionLeaves: FUNCTION_LEAVES,
          locale,
        }),
      ).toEqual({ missing: [], wrongType: [], orphans: [] });
    });
  }
});
