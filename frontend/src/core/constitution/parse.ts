import type {
  ConstitutionMiddleware,
  ConstitutionRecord,
  ConstitutionStage,
  ConstitutionTool,
  RunEventRow,
} from "./types";

/**
 * Parsing the snapshot off the run event stream, plus the one projection that
 * decides what belongs on the ring.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.2.
 * The record is rebuilt field by field rather than spread: a newer
 * `schema_version` is expected to add fields, and an unknown field is not part
 * of a shape the views can reason about.
 */

/** The stages the ring is divided into, in ring order. */
export const STAGE_KEYS = [
  "intake",
  "context",
  "model",
  "tools",
  "epilogue",
] as const;

/** The band outside the ring: the fallback for stages with no slot on it. */
export const EXTENSION_STAGE = "extension";

const STAGE_KEY_SET: ReadonlySet<string> = new Set(STAGE_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseStage(value: unknown): ConstitutionStage | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = value.key;
  if (typeof key !== "string" || key === "") {
    return null;
  }
  return {
    key,
    loop: asBoolean(value.loop),
    members: asNumber(value.members),
    gates: asNumber(value.gates),
    handoff_gates: asNumber(value.handoff_gates),
  };
}

function parseMiddlewareRow(value: unknown): ConstitutionMiddleware | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = value.name;
  if (typeof name !== "string" || name === "") {
    return null;
  }
  const row: ConstitutionMiddleware = {
    name,
    stage: asString(value.stage, EXTENSION_STAGE),
    kind: asString(value.kind, "member"),
    hooks: asArray(value.hooks).filter(
      (hook): hook is string => typeof hook === "string",
    ),
    frequency: asString(value.frequency, ""),
  };
  if (typeof value.overlay_kind === "string") {
    row.overlay_kind = value.overlay_kind;
  }
  if (value.exits_run === true) {
    row.exits_run = true;
  }
  return row;
}

function parseTool(value: unknown): ConstitutionTool | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = value.name;
  if (typeof name !== "string" || name === "") {
    return null;
  }
  return {
    name,
    source: asString(value.source, ""),
    group: asNullableString(value.group),
  };
}

function parseTools(value: unknown): ConstitutionRecord["tools"] {
  const raw = isRecord(value) ? value : {};
  const mounted = asArray(raw.mounted)
    .map(parseTool)
    .filter((tool): tool is ConstitutionTool => tool !== null);
  const deferred = asArray(raw.deferred_names).filter(
    (name): name is string => typeof name === "string",
  );
  return {
    mounted,
    mounted_count: asNumber(raw.mounted_count, mounted.length),
    deferred_names: deferred,
    deferred_count: asNumber(raw.deferred_count, deferred.length),
    auto_promote_top_k: asNumber(raw.auto_promote_top_k),
    truncated: asBoolean(raw.truncated),
  };
}

function findConstitution(
  rows: readonly RunEventRow[],
): Record<string, unknown> | null {
  for (const row of rows) {
    const content = row.content;
    if (!isRecord(content)) {
      continue;
    }
    if (isRecord(content.constitution)) {
      return content.constitution;
    }
  }
  return null;
}

/**
 * The snapshot from the first row that carries one — the backend attaches it
 * only to the first `run.start` of a run, so scanning beats taking row zero
 * (`run.start` fires again for each goal continuation, without the snapshot).
 */
export function parseConstitution(
  rows: readonly RunEventRow[],
): ConstitutionRecord | null {
  const raw = findConstitution(rows);
  if (raw === null) {
    return null;
  }
  const tools = parseTools(raw.tools);
  const authorization = isRecord(raw.tool_authorization)
    ? raw.tool_authorization
    : {};
  const skills = isRecord(raw.skills) ? raw.skills : {};
  const model = isRecord(raw.model) ? raw.model : {};
  const agent = isRecord(raw.agent) ? raw.agent : {};
  const removed = asArray(authorization.removed).filter(
    (name): name is string => typeof name === "string",
  );

  return {
    schema_version: asNumber(raw.schema_version, 1),
    model: {
      name: asNullableString(model.name),
      thinking_enabled: asBoolean(model.thinking_enabled),
      reasoning_effort: asNullableString(model.reasoning_effort),
    },
    agent: {
      name: asNullableString(agent.name),
      is_bootstrap: asBoolean(agent.is_bootstrap),
    },
    checkpoint_mode: asNullableString(raw.checkpoint_mode),
    runtime_flags: isRecord(raw.runtime_flags) ? raw.runtime_flags : {},
    stages: asArray(raw.stages)
      .map(parseStage)
      .filter((stage): stage is ConstitutionStage => stage !== null),
    middlewares: asArray(raw.middlewares)
      .map(parseMiddlewareRow)
      .filter((row): row is ConstitutionMiddleware => row !== null),
    tools,
    tool_authorization: {
      removed,
      removed_count: asNumber(authorization.removed_count, removed.length),
    },
    skills: {
      available_count: asNumber(skills.available_count),
      deferred_discovery: asBoolean(skills.deferred_discovery),
      describe_skill_bound: asBoolean(skills.describe_skill_bound),
    },
    mcp_routing_built: asBoolean(raw.mcp_routing_built),
    truncated: asBoolean(raw.truncated) || tools.truncated,
  };
}

/**
 * Ring stages in ring order, everything else in the out-of-ring band.
 *
 * The backend always emits the five canonical stages (zero counts included) and
 * appends `extension` only when it is non-empty, but an unrecognized key — a
 * stage added by a newer backend — must land in the band rather than be guessed
 * onto the ring.
 */
export function splitStages(stages: readonly ConstitutionStage[]): {
  ring: ConstitutionStage[];
  outside: ConstitutionStage[];
} {
  const byKey = new Map<string, ConstitutionStage>();
  const outside: ConstitutionStage[] = [];
  for (const stage of stages) {
    if (STAGE_KEY_SET.has(stage.key)) {
      byKey.set(stage.key, stage);
    } else {
      outside.push(stage);
    }
  }
  const ring: ConstitutionStage[] = [];
  for (const key of STAGE_KEYS) {
    const stage = byKey.get(key);
    if (stage) {
      ring.push(stage);
    }
  }
  return { ring, outside };
}

export interface MiddlewareGroup {
  key: string;
  rows: ConstitutionMiddleware[];
}

/**
 * The mounted middlewares, grouped by the stage they belong to: ring stages in
 * ring order first, then everything else in first-appearance order. Groups with
 * no rows are omitted — the ring already shows every canonical stage, and an
 * empty heading in the list would read as a stage that failed to load.
 */
export function groupMiddlewares(record: ConstitutionRecord): {
  ring: MiddlewareGroup[];
  outside: MiddlewareGroup[];
} {
  const byStage = new Map<string, MiddlewareGroup>();
  const outside: MiddlewareGroup[] = [];

  for (const row of record.middlewares) {
    const group = byStage.get(row.stage);
    if (group) {
      group.rows.push(row);
      continue;
    }
    const created: MiddlewareGroup = { key: row.stage, rows: [row] };
    byStage.set(row.stage, created);
    if (!STAGE_KEY_SET.has(row.stage)) {
      outside.push(created);
    }
  }

  const ring: MiddlewareGroup[] = [];
  for (const key of STAGE_KEYS) {
    const group = byStage.get(key);
    if (group) {
      ring.push(group);
    }
  }
  return { ring, outside };
}
