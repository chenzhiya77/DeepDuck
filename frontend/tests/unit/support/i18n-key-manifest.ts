/**
 * Shared machinery for the checked-in i18n key manifests.
 *
 * A manifest is the directory of frozen copy keys for one namespace, and the
 * guard's job is to prove the two locale objects carry exactly those keys — no
 * missing one, no orphan left behind by a rename. Both directions matter: a
 * missing key renders `undefined` at runtime, and an orphan is copy nobody will
 * ever see again.
 *
 * The manifest's own nesting differs per namespace (the constitution manifest is
 * `{core: {...}, middlewares: [...]}`), so callers hand this helper **dotted
 * paths relative to their namespace** rather than the raw manifest shape.
 *
 * Note `types.ts` needs no guard of its own: it and the two locale objects
 * constrain each other at compile time (`export const zhCN: Translations` rejects
 * both a missing and an extra key), so any drift that could survive that is
 * exactly a locale/manifest mismatch, which this catches.
 */

type Tree = Record<string, unknown>;

export interface ManifestCheckResult {
  /** Declared keys the locale does not carry. */
  missing: string[];
  /** Declared keys whose value is the wrong kind (or an empty string). */
  wrongType: string[];
  /** Keys the locale carries that the manifest does not declare. */
  orphans: string[];
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

export function checkLocaleAgainstManifest({
  namespace,
  expectedPaths,
  functionLeaves = [],
  locale,
}: {
  namespace: string;
  /** Dotted paths relative to `namespace`, e.g. `["stage.intake", "title"]`. */
  expectedPaths: readonly string[];
  /** Of those, the ones that take arguments and are therefore functions. */
  functionLeaves?: readonly string[];
  locale: unknown;
}): ManifestCheckResult {
  const functionLeafSet = new Set(functionLeaves);
  const tree =
    typeof locale === "object" && locale !== null
      ? ((locale as Tree)[namespace] as Tree | undefined)
      : undefined;

  const actual = new Set(tree === undefined ? [] : collectLeafPaths(tree));
  const expected = new Set(expectedPaths);

  const missing: string[] = [];
  const wrongType: string[] = [];
  for (const path of expected) {
    if (!actual.has(path)) {
      missing.push(path);
      continue;
    }
    const value = leafAt(tree!, path.split("."));
    const badType = functionLeafSet.has(path)
      ? typeof value !== "function"
      : typeof value !== "string" || value === "";
    if (badType) {
      wrongType.push(`${path} (${typeof value})`);
    }
  }
  const orphans = [...actual].filter((path) => !expected.has(path)).sort();

  return { missing: missing.sort(), wrongType, orphans };
}
