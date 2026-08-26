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
  // Each composed candidate must appear verbatim: Tailwind's static scanner
  // cannot see dynamically interpolated `variant:${utility}` fragments, so a
  // runtime-composed class silently produces no production CSS rule. The
  // parent-scoped arbitrary variant targets ui/progress.tsx's indicator
  // without hand-editing the generated primitive.
  if (value == null) return "[&_[data-slot=progress-indicator]]:bg-muted";
  if (value >= 0.8) return "[&_[data-slot=progress-indicator]]:bg-(--eval-ok)";
  if (value >= 0.6) return "[&_[data-slot=progress-indicator]]:bg-(--eval-warn)";
  return "[&_[data-slot=progress-indicator]]:bg-(--eval-danger)";
}

export type RagasSkipKind = "not-installed" | "error";

/** Classify the backend `ragas_skip_reason` for badge copy selection. The
 * "未安装" prefix is the stable constant from harness `ragas_unavailable_reason()`;
 * everything else (execution failure, empty output) is a runtime error whose raw
 * text belongs in a tooltip, not the product header. */
export function classifyRagasSkipReason(reason: string | null | undefined): RagasSkipKind {
  if (!reason || reason.startsWith("ragas 未安装")) return "not-installed";
  return "error";
}
