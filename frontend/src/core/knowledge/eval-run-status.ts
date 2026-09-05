/**
 * Pure derivations over the eval runs payload (spec 2026-08-27 §5.3). The
 * polling cadence lives here — like wiki-status.ts — so the hook wiring stays
 * trivially testable.
 */
import type { EvalRunListResponse, EvalRunProgress } from "./types";

/**
 * Polling cadence for the eval runs history while an on-demand run is in
 * flight — same 3s cadence as the documents and wiki queries; idle history
 * never polls.
 */
export const EVAL_RUNS_POLL_INTERVAL_MS = 3000;

/**
 * TanStack Query ``refetchInterval`` decision for the eval runs history:
 * poll only while the top-level ``in_flight`` flag reports a run in flight.
 * An undefined payload means the query is disabled or not yet fetched.
 */
export function evalRunsRefetchInterval(data: EvalRunListResponse | undefined): number | false {
  if (!data) return false;
  return data.in_flight ? EVAL_RUNS_POLL_INTERVAL_MS : false;
}

/**
 * True while the eval toolbar should render 运行中… — the pending flag covers
 * the click→first-poll gap (the 202 ack returns before the next poll sees the
 * top-level flag flip, wiki `isWikiUpdating` same-shape precedent).
 */
export function isEvalRunning(data: EvalRunListResponse | undefined, mutationPending: boolean): boolean {
  return mutationPending || (data?.in_flight ?? false);
}

/**
 * Button-visible count for the determinate questions phase only. layer1 is a
 * single transient step and ragas has an unpredictable duration, so neither
 * carries a meaningful per-item count — they render the bare 运行中… (null).
 */
export function progressLabel(progress: EvalRunProgress | null | undefined): { done: number; total: number } | null {
  if (progress?.phase !== "questions") return null;
  return { done: progress.done, total: progress.total };
}

/**
 * The bottom-edge line is determinate only for the questions phase; layer1 and
 * ragas pulse instead — never fake a percentage (spec § semantic discipline).
 * A running-without-progress state (null) also reads indeterminate so the line
 * still pulses until the first poll lands.
 */
export function isIndeterminatePhase(progress: EvalRunProgress | null | undefined): boolean {
  return progress?.phase !== "questions";
}

/**
 * Determinate fill fraction 0..1 for the questions phase; null when
 * indeterminate (the caller renders the pulse bar instead of a width) or when
 * total is non-positive (defensive divide-by-zero guard).
 */
export function progressFraction(progress: EvalRunProgress | null | undefined): number | null {
  if (progress?.phase !== "questions" || progress.total <= 0) return null;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

/** Phase words + failed suffix the progressbar aria-label is assembled from. */
export interface EvalProgressPhaseLabels {
  phaseLayer1: string;
  phaseQuestions: string;
  phaseRagas: string;
  failedCount: (n: number) => string;
}

/**
 * aria-label for the progress line: the phase word, plus a failed suffix when
 * any question failed. The numeric k/N is conveyed by the progressbar's
 * aria-valuenow/max (screen readers announce "k of N"), so it is not repeated
 * here. Returns null when there is no live progress.
 */
export function progressAriaLabel(progress: EvalRunProgress | null | undefined, labels: EvalProgressPhaseLabels): string | null {
  if (!progress) return null;
  const phaseWord = progress.phase === "layer1" ? labels.phaseLayer1 : progress.phase === "ragas" ? labels.phaseRagas : labels.phaseQuestions;
  return progress.failed > 0 ? `${phaseWord}，${labels.failedCount(progress.failed)}` : phaseWord;
}
