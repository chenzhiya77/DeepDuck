"use client";

import { CircleAlert, CircleStop } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { useRunOutcome } from "@/core/run-status/hooks";
import { cn } from "@/lib/utils";

/**
 * The run's ending, as a chip.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.2 / D3 — the badge answers "how did this end" at a glance, and the notice
 * answers "why, and what now". They are separate because they are read
 * differently: one is scanned while scrolling, the other is opened.
 *
 * `success` renders nothing, and so do `running` / `pending` — a run that worked
 * needs no chip, and one that has not finished has no ending to report. All three
 * fall out of the shared classifier as `none`, so this component keeps no status
 * list of its own and cannot drift from the classification table.
 */
export function RunStatusBadge({
  threadId,
  runId,
  enabled = true,
}: {
  threadId: string;
  runId?: string;
  enabled?: boolean;
}) {
  const { t } = useI18n();
  // Held off while the run is in flight by the caller: the query caches for the
  // run's lifetime, so a mid-run read would freeze `running` and never judge.
  const { data } = useRunOutcome({
    threadId,
    runId,
    enabled: enabled && Boolean(runId),
  });

  if (!data || data.kind === "none") {
    return null;
  }

  const failed = data.kind === "runFailed";
  const Icon = failed ? CircleAlert : CircleStop;

  return (
    <p
      data-testid="run-status-badge"
      data-kind={data.kind}
      className={cn(
        "mt-2 flex items-center gap-1.5 text-xs",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{failed ? t.runOutcome.runFailed : t.runOutcome.runStopped}</span>
    </p>
  );
}
