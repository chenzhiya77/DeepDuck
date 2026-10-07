import type { ManagedModel } from "./types";

/**
 * One provider block of the settings model list (spec 2026-10-08
 * models-list-grouping §2①). Rows keep merged order inside a group; groups keep
 * first-appearance order, so the default model's group leads.
 */
export interface ModelGroup {
  /** Allowlisted provider id, or "custom" when the stored `use:` maps to none. */
  provider: string;
  rows: ManagedModel[];
}

const CUSTOM_GROUP = "custom";
const KNOWN_PROVIDERS = new Set(["openai-compatible", "anthropic", "deepseek"]);

function groupKey(provider: ManagedModel["provider"]): string {
  return typeof provider === "string" && KNOWN_PROVIDERS.has(provider)
    ? provider
    : CUSTOM_GROUP;
}

/** Group rows by provider: groups in first-appearance order, rows in merged order. */
export function groupByProvider(rows: ManagedModel[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  const byKey = new Map<string, ModelGroup>();
  for (const row of rows) {
    const key = groupKey(row.provider);
    let group = byKey.get(key);
    if (!group) {
      group = { provider: key, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/**
 * Drag eligibility (spec §3 D2): a row moves only when it is UI-managed and its
 * merged slot is not pinned by config.yaml — one judgment covering both pinned
 * kinds (config_file entries and same-name overrides).
 */
export function isMovableRow(row: ManagedModel): boolean {
  return row.editable && !row.order_pinned;
}

/**
 * Move `sourceName` into the crossed row's slot (sortable-style), clamped to the
 * group's movable sub-block (spec §2③, review ★2): crossing a pinned row or a
 * group boundary is a no-op — the same array reference comes back, so no
 * half-step displacement can sneak in.
 */
export function reorderMovable(
  groups: ModelGroup[],
  sourceName: string,
  targetName: string,
): ModelGroup[] {
  if (sourceName === targetName) return groups;
  let sourceGroup: ModelGroup | undefined;
  let targetGroup: ModelGroup | undefined;
  for (const group of groups) {
    if (group.rows.some((row) => row.name === sourceName)) sourceGroup = group;
    if (group.rows.some((row) => row.name === targetName)) targetGroup = group;
  }
  if (!sourceGroup || sourceGroup !== targetGroup) return groups;
  const sourceRow = sourceGroup.rows.find((row) => row.name === sourceName);
  const targetRow = sourceGroup.rows.find((row) => row.name === targetName);
  if (!sourceRow || !targetRow) return groups;
  if (!isMovableRow(sourceRow) || !isMovableRow(targetRow)) return groups;

  const rows = [...sourceGroup.rows];
  const from = rows.findIndex((row) => row.name === sourceName);
  const to = rows.findIndex((row) => row.name === targetName);
  if (from === -1 || to === -1) return groups;
  // The kb-order idiom (`commitMove`): splice the source into the target's *original*
  // slot. Computing the slot on the post-removal array off-by-ones a downward move
  // (the target shifts left when the source leaves) and the crossing becomes a no-op.
  rows.splice(to, 0, rows.splice(from, 1)[0]!);
  return groups.map((group) =>
    group === sourceGroup ? { provider: group.provider, rows } : group,
  );
}

/**
 * Write-back order (spec §2③, review ★2): group order × in-group order, UI
 * entries only (config_file rows never enter `models_config.json`). This is the
 * array `PUT /api/models/config` receives — "display order" is ambiguous under
 * grouping, so the flatten is the spelled-out contract, and it makes
 * drag → save → reload → display-identical hold by construction.
 */
export function flattenUiOrder(groups: ModelGroup[]): ManagedModel[] {
  return groups.flatMap((group) => group.rows.filter((row) => row.editable));
}

/** All rows in grouped display order — the flat list the page renders from. */
export function groupsToFlat(groups: ModelGroup[]): ManagedModel[] {
  return groups.flatMap((group) => group.rows);
}
