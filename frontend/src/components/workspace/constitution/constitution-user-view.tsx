"use client";

import { useState } from "react";

import type {
  ConstitutionStage,
  GateNotification,
} from "@/core/constitution/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ConstitutionRing } from "./constitution-ring";

/**
 * What the agent is doing, in the user's own words.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.1.
 * This tier reads `stages[]` and the gate events — never `middlewares[]`,
 * `tools`, or `tool_authorization` — so an internal name cannot reach it even by
 * accident. That is why the props are stages and gates rather than the whole
 * record: the projection is enforced by what the component can see, not by
 * restraint at the render site.
 *
 * The gate notices are the whole point of the tier: today a user sees the agent
 * go quiet and assumes it broke.
 */
const MAX_NOTICES = 3;

export interface ConstitutionUserViewProps {
  stages: readonly ConstitutionStage[];
  gates: readonly GateNotification[];
  selectedKey: string | null;
  onSelectStage: (key: string) => void;
  className?: string;
}

export function ConstitutionUserView({
  stages,
  gates,
  selectedKey,
  onSelectStage,
  className,
}: ConstitutionUserViewProps) {
  const { t } = useI18n();
  // Pointing at a segment describes it; clicking pins it so the line survives
  // moving the pointer away to read it.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const describedKey = hoveredKey ?? selectedKey;

  const stageLabel = (key: string) =>
    (t.constitution.stage as Record<string, string>)[key] ?? key;
  const activity =
    describedKey === null
      ? null
      : (t.constitution.activity as Record<string, string>)[describedKey];

  // Newest first: the most recent decision is the one that explains the run.
  const notices = gates.slice(-MAX_NOTICES).reverse();

  return (
    <div
      data-testid="constitution-user-view"
      className={cn("flex flex-col items-center gap-4", className)}
    >
      <div className="w-full max-w-[22rem]">
        <ConstitutionRing
          stages={stages}
          labelForStage={stageLabel}
          segmentLabel={t.constitution.a11y.segment}
          selectedKey={describedKey}
          onSelectStage={onSelectStage}
          onHoverStage={setHoveredKey}
        />
      </div>

      {/* Held open (invisible, not unmounted) so describing a segment does not
          shove the notices up and down under the pointer. */}
      <p
        data-testid="constitution-activity"
        className={cn(
          "text-muted-foreground min-h-5 text-center text-sm",
          activity == null && "invisible",
        )}
      >
        {activity}
      </p>

      {notices.length > 0 && (
        <ul className="flex w-full flex-col gap-1.5">
          {notices.map((notice) => (
            <li
              key={`${notice.tag}-${notice.name}-${JSON.stringify(notice.changes)}`}
              data-testid="constitution-gate-notice"
              className="bg-muted/60 text-muted-foreground rounded-md px-3 py-1.5 text-xs"
            >
              {(t.constitution.gate as Record<string, string>)[notice.tag] ??
                notice.tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
