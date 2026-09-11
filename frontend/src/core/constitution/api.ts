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
  const rows = await fetchRows(
    threadId,
    runId,
    new URLSearchParams({
      event_types: "run.start",
      limit: String(RUN_START_LIMIT),
    }),
  );
  return parseConstitution(rows);
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
