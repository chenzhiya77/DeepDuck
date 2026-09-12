import { describe, expect, it } from "@rstest/core";

import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import keyManifest from "@/core/run-status/run-status-i18n-keys.json";
import { PRESENTED_KINDS } from "@/core/run-status/types";

import { checkLocaleAgainstManifest } from "../../support/i18n-key-manifest";

/**
 * Guard for the frozen `runOutcome.*` copy table.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §5.
 *
 * Two lists, because they answer different questions. `kinds` is the subset of
 * `FailureKind` that reaches the UI at all — `success`, a run still in flight, and
 * the two frontend-bug statuses (422/501) render nothing and have no sentence —
 * and it is pinned against the exported `PRESENTED_KINDS` constant so a new kind
 * cannot ship without copy. `keys` is that copy, and the shared helper proves both
 * locales carry exactly it: no missing key rendering `undefined`, no orphan left
 * behind by a rename.
 *
 * The kind-to-key mapping itself is deliberately not declared here. It belongs to
 * the component that renders the sentence, and its test pins it.
 */
const LOCALES = [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const;

describe("run-status i18n key manifest", () => {
  it("declares copy for exactly the kinds the UI can present", () => {
    expect(keyManifest.kinds).toEqual([...PRESENTED_KINDS]);
  });

  for (const [localeName, locale] of LOCALES) {
    it(`${localeName} covers every manifest key and nothing else`, () => {
      expect(
        checkLocaleAgainstManifest({
          namespace: "runOutcome",
          expectedPaths: keyManifest.keys,
          locale,
        }),
      ).toEqual({ missing: [], wrongType: [], orphans: [] });
    });
  }
});
