import { splitStages } from "./parse";
import type { ConstitutionStage } from "./types";

/**
 * The ring's geometry — the whole layout is a pure function of the stage list.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §5.1.
 * Angles follow the screen convention (0° points right, clockwise is positive),
 * which is also SVG's, so no coordinate flipping is needed: the arcs start at
 * -90° (twelve o'clock) and the five stages divide the circle equally, with a
 * gap between neighbours. Equal division rather than weighting by member count:
 * a stage with no members would otherwise collapse to a point, and the pointer
 * speed would jump with the configuration.
 */

/** The square the ring is laid out in; the SVG viewBox is `0 0 360 360`. */
export const RING_VIEWBOX = 360;
export const RING_CENTER = RING_VIEWBOX / 2;
/** Radius of the arc centreline. */
export const RING_RADIUS = 118;
/** Thickness of the arc band. */
export const RING_BAND = 40;
export const RING_GAP_DEG = 6;
export const RING_START_DEG = -90;

/** Radius of the looping three stages' shared track, outside the arcs. */
export const LOOP_TRACK_RADIUS = RING_RADIUS + RING_BAND / 2 + 8;
/** Radius of the out-of-ring band, outside the loop track. */
export const OUTSIDE_BAND_RADIUS = LOOP_TRACK_RADIUS + 6;
export const OUTSIDE_BAND_WIDTH = 12;
/** Labels live in the empty middle, clear of the arcs' inner edge. */
export const LABEL_RADIUS = RING_RADIUS - RING_BAND / 2 - 28;
/** Badges sit on the arc's centreline, where their own background reads. */
export const BADGE_RADIUS = RING_RADIUS;
/** The stage the chain exits on; the out-of-ring band hangs outside it. */
export const EXIT_STAGE_KEY = "epilogue";

/** The five stages share the circle; the count comes from the ring, not a constant. */
export function spanDeg(count: number): number {
  return count === 0 ? 0 : (360 - RING_GAP_DEG * count) / count;
}

export const RING_SPAN_DEG = spanDeg(5);

export interface RingArc {
  key: string;
  loop: boolean;
  startDeg: number;
  endDeg: number;
  centerDeg: number;
  members: number;
  gates: number;
  handoffGates: number;
}

export interface RingLayout {
  ring: RingArc[];
  /** Stages with no slot on the ring: the extension band plus unrecognized keys. */
  outside: ConstitutionStage[];
}

function point(radius: number, deg: number): { x: number; y: number } {
  const radians = (deg * Math.PI) / 180;
  return {
    x: RING_CENTER + radius * Math.cos(radians),
    y: RING_CENTER + radius * Math.sin(radians),
  };
}

function round(value: number): string {
  return value.toFixed(2);
}

/** Raw coordinates on the ring, inside the `RING_VIEWBOX` square. */
export function polarPoint(
  radius: number,
  deg: number,
): { x: number; y: number } {
  return point(radius, deg);
}

/** An SVG arc path, sweeping clockwise from `startDeg` to `endDeg`. */
export function arcPath(
  startDeg: number,
  endDeg: number,
  radius: number,
): string {
  const from = point(radius, startDeg);
  const to = point(radius, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${round(from.x)} ${round(from.y)} A ${radius} ${radius} 0 ${largeArc} 1 ${round(to.x)} ${round(to.y)}`;
}

/** Where a point on the ring sits inside the square, as CSS percentages. */
export function polarPercent(
  radius: number,
  deg: number,
  box: number = RING_VIEWBOX,
): { left: string; top: string } {
  const { x, y } = point(radius, deg);
  return {
    left: `${round((x / box) * 100)}%`,
    top: `${round((y / box) * 100)}%`,
  };
}

export function ringLayout(stages: readonly ConstitutionStage[]): RingLayout {
  const { ring: ringStages, outside } = splitStages(stages);
  const span = spanDeg(ringStages.length);
  const step = span + RING_GAP_DEG;

  const ring = ringStages.map((stage, index): RingArc => {
    const startDeg = RING_START_DEG + index * step;
    return {
      key: stage.key,
      loop: stage.loop,
      startDeg,
      endDeg: startDeg + span,
      centerDeg: startDeg + span / 2,
      members: stage.members,
      gates: stage.gates,
      handoffGates: stage.handoff_gates,
    };
  });

  return { ring, outside };
}
