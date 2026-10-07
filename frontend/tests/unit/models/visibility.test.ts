/**
 * 对话模型选择器的可见选项过滤（spec 2026-10-08 models-list-grouping §2④，plan Task 2）。
 * 钉死：① 隐藏项退出**可选项**（★1 反面）② 默认模型恒豁免（名单含默认名也照常展示，★1）
 * ③ 不动调用方的全量列表——当前选中 / 兜底查找 (`models.find` / `models[0]`) 吃的
 *    仍是全量（D3 边界：过滤只做可选项，不进 `useModels` 本体）。
 */
import { describe, expect, it } from "@rstest/core";

import type { Model } from "@/core/models/types";
import { chatPickerOptions } from "@/core/models/visibility";

function model(name: string, hidden = false): Model {
  return {
    id: name,
    name,
    model: `${name}-model`,
    display_name: name,
    hidden_in_chat: hidden,
  };
}

describe("chatPickerOptions", () => {
  it("drops hidden models from the picker options", () => {
    const options = chatPickerOptions([
      model("a"),
      model("b", true),
      model("c"),
    ]);

    expect(options.map((m) => m.name)).toEqual(["a", "c"]);
  });

  it("always keeps the default model (merged first) even when hidden", () => {
    const options = chatPickerOptions([model("a", true), model("b")]);

    expect(options.map((m) => m.name)).toEqual(["a", "b"]);
  });

  it("leaves the caller's full list untouched for find/fallback lookups", () => {
    const all = [model("a", true), model("b")];

    chatPickerOptions(all);

    expect(all.map((m) => m.name)).toEqual(["a", "b"]);
    expect(all[0]!.hidden_in_chat).toBe(true);
    expect(all[0]).toBe(all[0]);
  });
});
