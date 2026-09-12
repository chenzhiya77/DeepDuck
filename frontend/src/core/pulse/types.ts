/**
 * Shapes for the live pulse: where a run in flight sits on the ring, and how far
 * it has come.
 *
 * Spec: docs/superpowers/specs/2026-09-13-harness-live-pulse-design.md §4.
 */

/**
 * The ring segments the pointer can be on.
 *
 * A literal list rather than the snapshot's `stages[]`: the pulse answers before
 * any snapshot is consulted, and these are the ones its rule table can actually
 * tell apart. `context` is deliberately absent — in the message stream it is
 * indistinguishable from `intake`, and the spec accepts that approximation
 * (its risk 1) rather than inventing a signal for it.
 */
export const PULSE_STAGES = ["intake", "model", "tools", "epilogue"] as const;

export type PulseStage = (typeof PULSE_STAGES)[number];

/** Which segment the pointer sits on, and how many laps it has run. */
export interface PulseState {
  stageKey: PulseStage;
  lap: number;
}
