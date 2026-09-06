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
 * Total phases in the full-run pipeline (layer1 → questions → ragas). The
 * toolbar button renders the live phase as「阶段名 n/EVAL_PHASE_COUNT」so the
 * user always knows where in the pipeline the run is — the spec 2026-09-06
 * revision replaces the two indeterminate phases that both used to read a
 * bare, indistinguishable 运行中….
 */
export const EVAL_PHASE_COUNT = 3;

/**
 * 1-based position of the phase in the 3-phase pipeline. A running-without-
 * progress state (null / undefined — the optimistic window before the first
 * poll lands) defaults to step 1 so the button reads「检索评测 1/3」the instant
 * a full run is triggered.
 */
export function phaseStep(progress: EvalRunProgress | null | undefined): number {
  if (progress?.phase === "questions") return 2;
  if (progress?.phase === "ragas") return 3;
  return 1;
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

// ── 加权整体进度条（spec 2026-09-06 §9）─────────────────────────

/** 档位（run 的 layers）——决定流水线有几段：快速档只有 layer1。 */
export type EvalTier = "l1" | "l1_l2";

type EvalPhase = EvalRunProgress["phase"];

/** 各段占条的跨度权重（占比，总和 1）。 */
export type EvalPhaseWeights = Partial<Record<EvalPhase, number>>;

/** 流水线顺序：进度条的跨度与刻线按此排列。 */
export const EVAL_PHASE_ORDER: EvalPhase[] = ["layer1", "questions", "ragas"];

/**
 * 先验时长占比（冷启动猜测）：layer1 秒级、答题每题一次 agent run、质量评估
 * （ragas jobs + citation judge）是已知瓶颈。先验仅用于未实测前；某段一完成就用
 * 实测时长取代，因此无需任何历史存储字段。
 */
export const PHASE_WEIGHT_PRIOR: Record<EvalTier, EvalPhaseWeights> = {
  l1_l2: { layer1: 0.1, questions: 0.35, ragas: 0.55 },
  l1: { layer1: 1 },
};

/** 亚秒完成的段实测为 0s；下限避免它的跨度塌陷并污染 scale。 */
export const MIN_PHASE_SECONDS = 1;

/** 速率外推的 warmup 门控：进度/时长不足时宁可不给 ETA，也不给假数字。 */
export const ETA_WARMUP_FRACTION = 0.06;
export const ETA_WARMUP_SECONDS = 20;

function phasesFor(tier: EvalTier): EvalPhase[] {
  return tier === "l1" ? ["layer1"] : EVAL_PHASE_ORDER;
}

function parseMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/** 当前段；进度缺失或 phase 不属本档位时降级到首段（乐观窗口同款）。 */
function currentPhase(progress: EvalRunProgress | null | undefined, phases: EvalPhase[]): EvalPhase {
  const fallback = phases[0] ?? "layer1";
  return progress && phases.includes(progress.phase) ? progress.phase : fallback;
}

/**
 * 各段跨度的时长权重（spec 2026-09-06 §9）。
 *
 * 已完成段用实测时长；剩余段按先验比例缩放到已观测的速率（scale = 实测和 /
 * 已完成段先验和），因此条的几何会随运行自我校准而无需存储历史。当前段一旦
 * 超时，它的跨度会变宽（取期望与已跑时长的较大者）——慢的 ragas 段是把条拉长，
 * 而不是让条停在原地假装不动。
 */
export function adaptiveWeights(progress: EvalRunProgress | null | undefined, tier: EvalTier, nowMs: number = Date.now()): EvalPhaseWeights {
  const phases = phasesFor(tier);
  const prior = PHASE_WEIGHT_PRIOR[tier];
  const current = currentPhase(progress, phases);
  const measured = progress?.phase_durations ?? {};
  const currentIndex = phases.indexOf(current);

  let measuredSum = 0;
  let priorCompletedSum = 0;
  for (const phase of phases.slice(0, currentIndex)) {
    const observed = measured[phase];
    if (typeof observed === "number" && Number.isFinite(observed)) {
      measuredSum += Math.max(observed, MIN_PHASE_SECONDS);
      priorCompletedSum += prior[phase] ?? 0;
    }
  }
  const scale = priorCompletedSum > 0 && measuredSum > 0 ? measuredSum / priorCompletedSum : 1;
  // 仅当至少一段已有实测时，scale 才具备「秒 / 先验占比」的量纲；冷启动下
  // 先验仍是无量纲占比，不能与已跑秒数比大小（否则条一开跑就被拉宽）。
  const calibrated = priorCompletedSum > 0 && measuredSum > 0;

  const startedMs = parseMs(progress?.phase_started_at);
  const currentElapsed = startedMs === null ? null : Math.max((nowMs - startedMs) / 1000, 0);

  const durations: EvalPhaseWeights = {};
  for (const [index, phase] of phases.entries()) {
    const observed = measured[phase];
    if (index < currentIndex && typeof observed === "number" && Number.isFinite(observed)) {
      durations[phase] = Math.max(observed, MIN_PHASE_SECONDS);
      continue;
    }
    const expected = (prior[phase] ?? 0) * scale;
    durations[phase] = index === currentIndex && calibrated && currentElapsed !== null ? Math.max(expected, currentElapsed) : expected;
  }

  const total = phases.reduce((sum, phase) => sum + (durations[phase] ?? 0), 0);
  if (total <= 0) {
    // 防御：无先验也无实测时等分，保证条仍可渲染。
    const even = 1 / phases.length;
    return Object.fromEntries(phases.map((phase) => [phase, even])) as EvalPhaseWeights;
  }
  return Object.fromEntries(phases.map((phase) => [phase, (durations[phase] ?? 0) / total])) as EvalPhaseWeights;
}

/**
 * 加权整体完成度 0..1：已完成段权重和 + 当前段权重 × 段内 done/total。
 * 段内 total 非正（如无 evaluator 且无 judge 的质量段）时该段计 0，不产生 NaN。
 */
export function overallFraction(progress: EvalRunProgress | null | undefined, tier: EvalTier, nowMs: number = Date.now()): number {
  if (!progress) return 0;
  const phases = phasesFor(tier);
  const weights = adaptiveWeights(progress, tier, nowMs);
  const current = currentPhase(progress, phases);

  let completed = 0;
  for (const phase of phases) {
    if (phase === current) break;
    completed += weights[phase] ?? 0;
  }
  const within = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
  return Math.min(1, Math.max(0, completed + (weights[current] ?? 0) * within));
}

/**
 * 预计剩余秒数（主流速率外推口径）：`elapsed × (1−f) / f`。warmup 不足
 * （f 或 elapsed 太小）时返回 null 而不是撒谎；收尾时钳到 0，永不负。
 */
export function etaSeconds(progress: EvalRunProgress | null | undefined, tier: EvalTier, nowMs: number = Date.now()): number | null {
  const fraction = overallFraction(progress, tier, nowMs);
  if (fraction <= ETA_WARMUP_FRACTION) return null;
  const startedMs = parseMs(progress?.started_at);
  if (startedMs === null) return null;
  const elapsed = (nowMs - startedMs) / 1000;
  if (elapsed < ETA_WARMUP_SECONDS) return null;
  return Math.max(0, (elapsed * (1 - fraction)) / fraction);
}

/** ETA 取整到分钟（下限 1）——防抽风跳变，也是 UI 唯一的展示粒度。 */
export function etaMinutes(eta: number | null): number | null {
  if (eta === null) return null;
  return Math.max(1, Math.round(eta / 60));
}
