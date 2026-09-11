import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import { GATE_EVENT_TYPES, mergeGateEvents, parseGateRow } from "./gate-events";
import { parseConstitution } from "./parse";
import type {
  ConstitutionRecord,
  GateNotification,
  RunEventRow,
} from "./types";

/**
 * The two reads the view needs, both off the run events route.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.2–§4.3.
 * The snapshot is fetch-once (it does not change within a run); the gate events
 * are the persisted leg of a dual-delivered event, filled in on open so a
 * reloaded page still shows what the gates did.
 */

/** Rows to scan for the snapshot: `run.start` fires once per astream. */
const RUN_START_LIMIT = 20;
const GATE_EVENT_LIMIT = 500;
/**
 * A run's first `run.start` reaches the store a moment *after* the run is
 * created — measured 0.17 s to 2.2 s — while the page asks as soon as it knows
 * the run id. An empty answer would then be held for the rest of the run (the
 * caller caches it with `staleTime: Infinity`, because a snapshot never changes
 * once written), so "not there yet" has to be retried rather than accepted.
 * Bounded: a run whose chain publishes no snapshot costs these attempts once.
 */
const SNAPSHOT_ATTEMPTS = 6;
const SNAPSHOT_RETRY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventsUrl(
  threadId: string,
  runId: string,
  params: URLSearchParams,
): string {
  const base = `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/events`;
  return `${base}?${params.toString()}`;
}

async function fetchRows(
  threadId: string,
  runId: string,
  params: URLSearchParams,
): Promise<RunEventRow[]> {
  const res = await fetch(eventsUrl(threadId, runId, params));
  if (!res.ok) {
    throw new Error(`Failed to fetch run events: ${res.status}`);
  }
  return (await res.json()) as RunEventRow[];
}

/** The run's assembled harness, or null when this run has no snapshot. */
export async function fetchConstitution(
  threadId: string,
  runId: string,
): Promise<ConstitutionRecord | null> {
  const params = new URLSearchParams({
    event_types: "run.start",
    limit: String(RUN_START_LIMIT),
  });

  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    const record = parseConstitution(await fetchRows(threadId, runId, params));
    if (record !== null || attempt === SNAPSHOT_ATTEMPTS) {
      return record;
    }
    await delay(SNAPSHOT_RETRY_MS);
  }
  return null;
}

/** Every gate that acted in this run, oldest first. */
export async function fetchGateEvents(
  threadId: string,
  runId: string,
): Promise<GateNotification[]> {
  const rows = await fetchRows(
    threadId,
    runId,
    new URLSearchParams({
      event_types: GATE_EVENT_TYPES,
      limit: String(GATE_EVENT_LIMIT),
    }),
  );
  const persisted = rows
    .map(parseGateRow)
    .filter((event): event is GateNotification => event !== null);
  return mergeGateEvents(persisted, []);
}
