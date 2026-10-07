/**
 * 分组派生、组内拖动与写回序（spec 2026-10-08 models-list-grouping §2①③，plan Task 2）。
 * 钉死：① 组序=首次出现序、组内序=合并序 ② 可拖条件 = `editable && !order_pinned`
 * ③ clamp：拖往钉住行方向 = no-op（原样返回同一引用，不产生半格位移，★2）
 * ④ 写回序 = 分组展平序（组序 × 组内序，只取 UI 条目，★2）
 * ⑤ 稳定性：拖 → 存 → 重载 → 显示序不变（★2）。
 */
import { describe, expect, it } from "@rstest/core";

import {
  flattenUiOrder,
  groupByProvider,
  groupsToFlat,
  isMovableRow,
  reorderMovable,
} from "@/core/models/grouping";
import type { ManagedModel } from "@/core/models/types";

function row(over: Partial<ManagedModel> & { name: string }): ManagedModel {
  return {
    model: `${over.name}-model`,
    api_key: "********",
    source: "ui",
    editable: true,
    ...over,
  };
}

/** config.yaml 两条 + 同名顶替一条 + 纯 UI 三条（deepseek 组、openai 组各一）。 */
function baseRows(): ManagedModel[] {
  return [
    row({
      name: "cfg",
      provider: "deepseek",
      source: "config_file",
      editable: false,
      order_pinned: true,
    }),
    row({ name: "ovr", provider: "deepseek", order_pinned: true }),
    row({ name: "u1", provider: "deepseek" }),
    row({ name: "u2", provider: "deepseek" }),
    row({ name: "u3", provider: "deepseek" }),
    row({ name: "other", provider: "openai-compatible" }),
  ];
}

describe("groupByProvider", () => {
  it("groups in first-appearance order, keeping merged order inside a group", () => {
    const groups = groupByProvider(baseRows());

    expect(groups.map((g) => g.provider)).toEqual([
      "deepseek",
      "openai-compatible",
    ]);
    expect(groups[0]!.rows.map((r) => r.name)).toEqual([
      "cfg",
      "ovr",
      "u1",
      "u2",
      "u3",
    ]);
    expect(groups[1]!.rows.map((r) => r.name)).toEqual(["other"]);
  });

  it("puts entries without a known provider into one custom group", () => {
    const groups = groupByProvider([
      row({ name: "a", provider: null }),
      row({ name: "b", provider: null }),
      row({ name: "c", provider: "deepseek" }),
    ]);

    expect(groups.map((g) => g.provider)).toEqual(["custom", "deepseek"]);
    expect(groups[0]!.rows.map((r) => r.name)).toEqual(["a", "b"]);
  });
});

describe("isMovableRow", () => {
  it("is editable and not order_pinned — one judgment for both pinned kinds", () => {
    expect(isMovableRow(row({ name: "ui" }))).toBe(true);
    expect(
      isMovableRow(
        row({ name: "cfg", source: "config_file", editable: false }),
      ),
    ).toBe(false);
    expect(isMovableRow(row({ name: "ovr", order_pinned: true }))).toBe(false);
  });
});

describe("reorderMovable", () => {
  it("moves the lifted row into the crossed row's slot", () => {
    const groups = groupByProvider(baseRows());

    const next = reorderMovable(groups, "u3", "u1");

    expect(next[0]!.rows.map((r) => r.name)).toEqual([
      "cfg",
      "ovr",
      "u3",
      "u1",
      "u2",
    ]);
  });

  it("takes the slot on a downward crossing too (the source shifts the target up)", () => {
    // The upward case alone hides an off-by-one: removing the source first shifts
    // the target left, and inserting at its post-removal index undoes the move.
    const groups = groupByProvider(baseRows());

    const next = reorderMovable(groups, "u1", "u2");

    expect(next[0]!.rows.map((r) => r.name)).toEqual([
      "cfg",
      "ovr",
      "u2",
      "u1",
      "u3",
    ]);
  });

  it("clamps at the pinned sub-block: crossing a pinned row is a no-op", () => {
    const groups = groupByProvider(baseRows());

    expect(reorderMovable(groups, "u1", "ovr")).toBe(groups);
    expect(reorderMovable(groups, "u1", "cfg")).toBe(groups);
    expect(reorderMovable(groups, "ovr", "u1")).toBe(groups);
    expect(reorderMovable(groups, "cfg", "u1")).toBe(groups);
  });

  it("never crosses groups", () => {
    const groups = groupByProvider(baseRows());

    expect(reorderMovable(groups, "u1", "other")).toBe(groups);
  });
});

describe("flattenUiOrder", () => {
  it("writes back UI entries in grouped flatten order (group order x in-group order)", () => {
    const groups = groupByProvider(baseRows());

    expect(flattenUiOrder(groups).map((r) => r.name)).toEqual([
      "ovr",
      "u1",
      "u2",
      "u3",
      "other",
    ]);
  });
});

describe("stability: drag -> save -> reload", () => {
  /**
   * Mirrors the backend merge (`merge_ui_models`): yaml-declared names keep their
   * slot (a UI entry of the same name replaces in place), pure UI entries trail
   * in saved order. The saved array is the grouped flatten order.
   */
  function simulateReload(before: ManagedModel[], saved: ManagedModel[]) {
    const savedByName = new Map(saved.map((r) => [r.name, r]));
    const head = before
      .filter((r) => r.order_pinned)
      .map((r) => savedByName.get(r.name) ?? r);
    const tail = saved.filter((r) => !r.order_pinned);
    return [...head, ...tail];
  }

  it("keeps the displayed order identical across a save", () => {
    const before = baseRows();
    const dragged = reorderMovable(groupByProvider(before), "u3", "u1");
    expect(dragged).not.toBe(groupByProvider(before));

    const saved = flattenUiOrder(dragged);
    const reloaded = groupByProvider(simulateReload(before, saved));

    expect(reloaded).toEqual(dragged);
  });

  it("normalizing rows to grouped order does not change the display", () => {
    const before = baseRows();
    const groups = groupByProvider(before);

    expect(groupByProvider(groupsToFlat(groups))).toEqual(groups);
  });
});
