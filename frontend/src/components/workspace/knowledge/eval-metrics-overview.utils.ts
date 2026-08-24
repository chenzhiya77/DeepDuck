/**
 * Pure utility functions for eval metrics visualization (spec 2026-08-24 §3.3/§3.4).
 *
 * JSdom testable — no DOM dependencies. Align with vector-canvas/graph-utils patterns.
 */
import { cn } from "@/lib/utils";

export function getCellColorClass(
  delta: number | null | undefined,
  thresholdPercent: number | null | undefined,
): string {
  /** No diff signal → default color. */
  if (delta == null || thresholdPercent == null) return "";

  /** Improvements or zero delta stay uncolored. */
  if (delta >= 0) return "";

  const threshold = thresholdPercent / 100;
  // Warning band: -threshold < delta < 0
  if (delta > -threshold) {
    return cn("bg-(--eval-warn-bg)", "text-(--eval-warn-fg)");
  }
  // Danger: delta <= -threshold
  return cn("bg-(--eval-danger-bg)", "text-(--eval-danger-fg)", "font-semibold");
}

export function getProgressBarColor(value: number | null | undefined): string {
  if (value == null) return "bg-muted";
  if (value >= 0.8) return "bg-(--eval-ok)";
  if (value >= 0.6) return "bg-(--eval-warn)";
  return "bg-(--eval-danger)";
}
