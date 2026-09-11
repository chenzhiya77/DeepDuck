import {
  GATE_TAGS,
  type GateNotification,
  type GateTag,
  type RunEventRow,
} from "./types";

/**
 * The two legs a gate event arrives on, normalized into one shape.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.3.
 * A live `custom` SSE frame carries `{type, name, hook, action, changes}`; the
 * persisted row wraps the same four fields in `content` under
 * `event_type: "middleware:<tag>"`. Both legs carry the same payload by design,
 * so a consumer that has both must fold the duplicate.
 */
const TAG_SET: ReadonlySet<string> = new Set(GATE_TAGS);

const MIDDLEWARE_PREFIX = "middleware:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asChanges(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function build(
  tag: string,
  name: unknown,
  hook: unknown,
  action: unknown,
  changes: unknown,
  seq?: number,
): GateNotification | null {
  if (!TAG_SET.has(tag) || typeof name !== "string" || name === "") {
    return null;
  }
  const notification: GateNotification = {
    tag: tag as GateTag,
    name,
    hook: typeof hook === "string" ? hook : "",
    action: typeof action === "string" ? action : "",
    changes: asChanges(changes),
  };
  if (typeof seq === "number") {
    notification.seq = seq;
  }
  return notification;
}

/** A live `custom` stream frame, or null when it is not a gate acting. */
export function parseGateFrame(event: unknown): GateNotification | null {
  if (!isRecord(event)) {
    return null;
  }
  const tag = event.type;
  if (typeof tag !== "string") {
    return null;
  }
  return build(tag, event.name, event.hook, event.action, event.changes);
}

/** A persisted `middleware:{tag}` row, or null when it is not a gate acting. */
export function parseGateRow(row: unknown): GateNotification | null {
  if (!isRecord(row)) {
    return null;
  }
  const eventType = row.event_type;
  if (
    typeof eventType !== "string" ||
    !eventType.startsWith(MIDDLEWARE_PREFIX)
  ) {
    return null;
  }
  const content = row.content;
  if (!isRecord(content)) {
    return null;
  }
  const seq = typeof row.seq === "number" ? row.seq : undefined;
  return build(
    eventType.slice(MIDDLEWARE_PREFIX.length),
    content.name,
    content.hook,
    content.action,
    content.changes,
    seq,
  );
}

/** Identity of a decision: the same gate acting the same way on the same facts. */
export function gateEventKey(notification: GateNotification): string {
  return JSON.stringify([
    notification.tag,
    notification.name,
    notification.changes,
  ]);
}

/**
 * One list out of both legs: persisted rows by `seq`, live frames in arrival
 * order, duplicates folded. Ascending — the notice stack renders it reversed.
 */
export function mergeGateEvents(
  persisted: readonly GateNotification[],
  live: readonly GateNotification[],
): GateNotification[] {
  const ordered = [...persisted].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const seen = new Set<string>();
  const merged: GateNotification[] = [];
  for (const notification of [...ordered, ...live]) {
    const key = gateEventKey(notification);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(notification);
  }
  return merged;
}

/** The persisted leg's `event_types` filter, comma-joined for the events route. */
export const GATE_EVENT_TYPES = GATE_TAGS.map(
  (tag) => `${MIDDLEWARE_PREFIX}${tag}`,
).join(",");

export type { GateNotification, RunEventRow };
