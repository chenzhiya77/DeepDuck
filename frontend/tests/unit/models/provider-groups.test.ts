/**
 * 「提供商」下拉的分组表（spec 2026-09-22 provider-grouping §3.1 / D1–D3）：
 * 三个 provider id 分成两组 —— 通用协议（说话方式）在前、厂商（原生客户端）在后。
 *
 * 钉死：① 两组的**顺序与成员**逐项；② 三个 `ProviderId` 在表里**各恰好一次**、且表里不出现
 * 第四个 id（新增 id 时 `PROVIDER_LABEL_KEYS` 的 `Record` 会先在 tsc 报错，这里是第二道网）；
 * ③ 每个 id 的文案 key 互不重复、集合就是那三个 `provider*`。表是唯一来源，弹窗按它渲染。
 */
import { describe, expect, it } from "@rstest/core";

import {
  PROVIDER_GROUPS,
  PROVIDER_LABEL_KEYS,
} from "@/core/models/provider-groups";
import type { ProviderId } from "@/core/models/types";

const ALL_IDS: readonly ProviderId[] = [
  "openai-compatible",
  "anthropic",
  "deepseek",
];

describe("PROVIDER_GROUPS", () => {
  it("keeps the generic protocols first and the vendors second, member for member", () => {
    expect(PROVIDER_GROUPS.map((group) => group.labelKey)).toEqual([
      "providerGroupGeneric",
      "providerGroupVendor",
    ]);
    expect(PROVIDER_GROUPS.map((group) => [...group.ids])).toEqual([
      ["openai-compatible", "anthropic"],
      ["deepseek"],
    ]);
  });

  it("lists every ProviderId exactly once — no duplicate, no stray id", () => {
    const listed = PROVIDER_GROUPS.flatMap((group) => [...group.ids]);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...new Set(listed)].sort()).toEqual([...ALL_IDS].sort());
  });
});

describe("PROVIDER_LABEL_KEYS", () => {
  it("gives every id its own provider* key", () => {
    const keys = Object.values(PROVIDER_LABEL_KEYS);

    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([
      "providerAnthropic",
      "providerDeepseek",
      "providerOpenaiCompatible",
    ]);
    expect(Object.keys(PROVIDER_LABEL_KEYS).sort()).toEqual(
      [...ALL_IDS].sort(),
    );
  });
});
