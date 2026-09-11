"use client";

import {
  BADGE_RADIUS,
  EXIT_STAGE_KEY,
  LABEL_RADIUS,
  LOOP_TRACK_RADIUS,
  OUTSIDE_BAND_RADIUS,
  OUTSIDE_BAND_WIDTH,
  RING_BAND,
  RING_RADIUS,
  RING_VIEWBOX,
  arcPath,
  polarPercent,
  polarPoint,
  ringLayout,
} from "@/core/constitution/geometry";
import type { ConstitutionStage } from "@/core/constitution/types";
import { cn } from "@/lib/utils";

/**
 * The ring, drawn.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §5.
 * Arcs are a thick stroke along the centreline; everything else — loop track,
 * out-of-ring band, handoff exit — is a thinner path at its own radius. Text and
 * badges are a DOM overlay positioned with `polarPercent`, because SVG `<text>`
 * would turn wrapping and localised typography into hand work (§8 risk 12).
 * The radii themselves live in `geometry.ts` so the layout is one inspectable
 * place, and pinned by the tests.
 *
 * The copy arrives as props rather than from `useI18n`: the ring is shared by
 * two views with different vocabularies, and a drawing primitive that picks one
 * is how the two drift back together.
 */
const OUTER_EDGE_RADIUS = RING_RADIUS + RING_BAND / 2;
const HANDOFF_EDGE_LENGTH = 22;
const HANDOFF_TIP_HALF_DEG = 5;

export interface ConstitutionRingProps {
  stages: readonly ConstitutionStage[];
  /** Stage label by stage key; the caller owns the vocabulary. */
  labelForStage: (key: string) => string;
  /** Screen-reader text for one ring segment, e.g. "Segment 2 of 5". */
  segmentLabel: (segment: number, total: number) => string;
  selectedKey?: string | null;
  onSelectStage?: (key: string) => void;
  className?: string;
}

export function ConstitutionRing({
  stages,
  labelForStage,
  segmentLabel,
  selectedKey,
  onSelectStage,
  className,
}: ConstitutionRingProps) {
  const { ring, outside } = ringLayout(stages);
  const exitArc =
    ring.find((arc) => arc.key === EXIT_STAGE_KEY) ?? ring[ring.length - 1];

  return (
    <div className={cn("relative aspect-square size-full", className)}>
      <svg
        className="size-full"
        viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
        fill="none"
      >
        {ring.map((arc, index) => {
          const selected = selectedKey === arc.key;
          return (
            <path
              key={arc.key}
              data-testid={`constitution-arc-${arc.key}`}
              data-selected={selected ? "true" : "false"}
              role="img"
              aria-label={segmentLabel(index + 1, ring.length)}
              d={arcPath(arc.startDeg, arc.endDeg, RING_RADIUS)}
              stroke="currentColor"
              strokeWidth={RING_BAND}
              className={cn(
                "cursor-pointer transition-colors",
                selected
                  ? "text-foreground/70"
                  : "text-muted-foreground/25 hover:text-muted-foreground/45",
              )}
              onClick={() => onSelectStage?.(arc.key)}
            />
          );
        })}

        {ring
          .filter((arc) => arc.loop)
          .map((arc) => (
            <path
              key={arc.key}
              data-testid={`constitution-loop-${arc.key}`}
              d={arcPath(arc.startDeg, arc.endDeg, LOOP_TRACK_RADIUS)}
              stroke="currentColor"
              strokeWidth={2}
              className="text-muted-foreground/40"
            />
          ))}

        {outside.length > 0 && exitArc && (
          <path
            data-testid="constitution-outside-band"
            d={arcPath(exitArc.startDeg, exitArc.endDeg, OUTSIDE_BAND_RADIUS)}
            stroke="currentColor"
            strokeWidth={OUTSIDE_BAND_WIDTH}
            className="text-muted-foreground/20"
          />
        )}

        {ring
          .filter((arc) => arc.handoffGates > 0)
          .map((arc) => (
            <HandoffExit key={arc.key} centerDeg={arc.centerDeg} />
          ))}
      </svg>

      {ring.map((arc) => (
        <button
          key={arc.key}
          type="button"
          data-testid={`constitution-node-${arc.key}`}
          aria-pressed={selectedKey === arc.key}
          style={polarPercent(LABEL_RADIUS, arc.centerDeg)}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-xs transition-colors",
            selectedKey === arc.key
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelectStage?.(arc.key)}
        >
          {labelForStage(arc.key)}
        </button>
      ))}

      {ring
        .filter((arc) => arc.gates + arc.handoffGates > 0)
        .map((arc) => (
          <span
            key={arc.key}
            data-testid={`constitution-badge-${arc.key}`}
            style={polarPercent(BADGE_RADIUS, arc.centerDeg)}
            className="bg-background absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
          >
            <span
              data-testid={`constitution-badge-total-${arc.key}`}
              className="font-mono"
            >
              {arc.gates + arc.handoffGates}
            </span>
            {arc.handoffGates > 0 && (
              <span
                data-testid={`constitution-badge-handoff-${arc.key}`}
                data-handoff="true"
                // A handoff is "control left the ring", not "something was
                // blocked", so it is marked apart from the count it shares.
                className="border-foreground/60 size-1.5 rotate-45 border"
              />
            )}
          </span>
        ))}

      {outside.length > 0 && exitArc && (
        <div
          data-testid="constitution-outside-nodes"
          style={polarPercent(OUTSIDE_BAND_RADIUS, exitArc.centerDeg)}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
        >
          {outside.map((entry) => (
            <span
              key={entry.key}
              data-testid={`constitution-outside-${entry.key}`}
              className="text-muted-foreground text-[10px]"
            >
              {labelForStage(entry.key)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A short spur leaving the ring, for a stage whose gate hands control back. */
function HandoffExit({ centerDeg }: { centerDeg: number }) {
  const from = polarPoint(OUTER_EDGE_RADIUS + 2, centerDeg);
  const to = polarPoint(OUTER_EDGE_RADIUS + HANDOFF_EDGE_LENGTH, centerDeg);
  const baseA = polarPoint(
    OUTER_EDGE_RADIUS + HANDOFF_EDGE_LENGTH,
    centerDeg - HANDOFF_TIP_HALF_DEG,
  );
  const baseB = polarPoint(
    OUTER_EDGE_RADIUS + HANDOFF_EDGE_LENGTH,
    centerDeg + HANDOFF_TIP_HALF_DEG,
  );
  const tip = polarPoint(
    OUTER_EDGE_RADIUS + HANDOFF_EDGE_LENGTH + 6,
    centerDeg,
  );

  return (
    <g data-testid="constitution-handoff-exit" className="text-foreground/60">
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="currentColor"
        strokeWidth={2}
      />
      <path
        d={`M ${baseA.x} ${baseA.y} L ${tip.x} ${tip.y} L ${baseB.x} ${baseB.y} Z`}
        fill="currentColor"
      />
    </g>
  );
}
