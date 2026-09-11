import { describe, expect, it } from "@rstest/core";

import keyManifest from "@/core/constitution/constitution-i18n-keys.json";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";

/**
 * Guard for the frozen `constitution.*` copy table.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §8.
 * The manifest is the checked-in key directory; the sibling backend guard
 * (`backend/tests/test_constitution_i18n_keys.py`) reads the same file to keep
 * the middleware names in step with `STAGE_OF_MIDDLEWARE`, so a renamed or
 * added middleware fails CI instead of silently rendering a bare class name.
 *
 * This file covers §8.2 guard 1 (both locales vs the manifest, both
 * directions). §8.2 guard 2 needs no separate test: `types.ts` and the two
 * locale objects constrain each other at compile time (`export const zhCN:
 * Translations` rejects both a missing and an extra key), and any drift that
 * could survive that is exactly a locale/manifest mismatch, which this file
 * already catches.
 */
type Tree = Record<string, unknown>;

// a11y.segment / a11y.total take arguments, so they are functions rather than
// strings. Listing them explicitly means a third function key added later
// fails the string assertions instead of silently passing.
const FUNCTION_LEAVES = new Set(["a11y.segment", "a11y.total"]);

const LOCALES = [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const;

function expectedPaths(): string[][] {
  const paths: string[][] = [];
  for (const [section, value] of Object.entries(keyManifest.core)) {
    if (value === true) {
      paths.push([section]);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        paths.push([section, entry]);
      }
    } else {
      throw new Error(`unexpected manifest shape at core.${section}`);
    }
  }
  for (const name of keyManifest.middlewares) {
    paths.push(["middleware", name]);
  }
  return paths;
}

function leafAt(tree: Tree, path: string[]): unknown {
  let node: unknown = tree;
  for (const segment of path) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Tree)[segment];
  }
  return node;
}

function collectLeafPaths(node: unknown, prefix: string[] = []): string[] {
  if (typeof node !== "object" || node === null) {
    return [prefix.join(".")];
  }
  const paths: string[] = [];
  for (const [key, value] of Object.entries(node as Tree)) {
    paths.push(...collectLeafPaths(value, [...prefix, key]));
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
      const tree = (locale as { constitution?: unknown }).constitution;
      const actual = new Set(tree === undefined ? [] : collectLeafPaths(tree));
      const expected = new Set(expectedPaths().map((path) => path.join(".")));

      const missing: string[] = [];
      const wrongType: string[] = [];
      for (const path of expected) {
        if (!actual.has(path)) {
          missing.push(path);
          continue;
        }
        const value = leafAt(tree as Tree, path.split("."));
        const isFunctionLeaf = FUNCTION_LEAVES.has(path);
        const badType = isFunctionLeaf
          ? typeof value !== "function"
          : typeof value !== "string" || value === "";
        if (badType) {
          wrongType.push(`${path} (${typeof value})`);
        }
      }
      const orphans = [...actual].filter((path) => !expected.has(path)).sort();

      expect({
        missing: missing.sort(),
        wrongType,
        orphans,
      }).toEqual({ missing: [], wrongType: [], orphans: [] });
    });
  }
});
