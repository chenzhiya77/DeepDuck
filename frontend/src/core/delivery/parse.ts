import {
  DELIVERY_STAGES,
  type DeliveryReceipt,
  type DeliveryStage,
  type DeliveryVerdict,
  type RunEventRow,
} from "./types";

/**
 * Reading the terminal delivery receipt off the run events stream.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §5.
 * The receipt is rebuilt field by field rather than spread, so a newer payload
 * field cannot leak into a shape the card never agreed to render.
 *
 * The one rule that matters: **a verdict or nothing.** The base record (what most
 * runs emit) carries no verdict at all, and the card's three branches are only
 * total if a half-written verdict is refused outright instead of being rendered
 * with holes in it.
 */
const RECEIPT_EVENT_TYPE = "run.delivery";
const STAGE_SET: ReadonlySet<string> = new Set(DELIVERY_STAGES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseVerification(value: unknown): DeliveryVerdict["verification"] {
  if (!isRecord(value)) {
    return null;
  }
  return {
    source: typeof value.source === "string" ? value.source : null,
    requirement:
      typeof value.requirement === "string" ? value.requirement : null,
  };
}

/** The verdict, or null when the receipt is not carrying a complete one. */
function parseVerdict(raw: Record<string, unknown>): DeliveryVerdict | null {
  const stage = raw.stage;
  const satisfied = raw.satisfied;
  if (typeof stage !== "string" || !STAGE_SET.has(stage)) {
    return null;
  }
  if (typeof satisfied !== "boolean") {
    return null;
  }
  const produced = asStringArray(raw.produced_paths);
  const presented = asStringArray(raw.presented_paths);
  const matched = asStringArray(raw.matched_paths);
  // All three lists or none: the counts the copy interpolates come from them, so
  // a missing one would render a sentence with a hole in it.
  if (produced === null || presented === null || matched === null) {
    return null;
  }
  return {
    stage: stage as DeliveryStage,
    satisfied,
    verification: parseVerification(raw.verification),
    produced_paths: produced,
    presented_paths: presented,
    matched_paths: matched,
  };
}

function parseByTool(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  const byTool: Record<string, string[]> = {};
  for (const [tool, paths] of Object.entries(value)) {
    const list = asStringArray(paths);
    if (list !== null) {
      byTool[tool] = list;
    }
  }
  return byTool;
}

function findReceipt(
  rows: readonly RunEventRow[],
): Record<string, unknown> | null {
  for (const row of rows) {
    if (row.event_type !== RECEIPT_EVENT_TYPE || !isRecord(row.content)) {
      continue;
    }
    return row.content;
  }
  return null;
}

/** The run's receipt, or null when this run published none. */
export function parseDeliveryReceipt(
  rows: readonly RunEventRow[],
): DeliveryReceipt | null {
  const raw = findReceipt(rows);
  if (raw === null) {
    return null;
  }
  const paths = asStringArray(raw.paths) ?? [];
  return {
    // The producer writes `presented: len(paths)` in the same record, so the
    // list is a faithful fallback rather than a re-derivation.
    presented: asNumber(raw.presented, paths.length),
    paths,
    by_tool: parseByTool(raw.by_tool),
    verdict: parseVerdict(raw),
  };
}
