"use client";

import { useState } from "react";

import type {
  ConstitutionRecord,
  ConstitutionView,
  GateNotification,
} from "@/core/constitution/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ConstitutionDeveloperView } from "./constitution-developer-view";
import { ConstitutionUserView } from "./constitution-user-view";

/**
 * The dialog's contents: the tier switch and whichever tier is chosen.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.3.
 * Split out of the dialog shell so `next/dynamic` can keep the ring and both
 * tiers out of the thread route's initial chunk — the shell is a button plus an
 * empty dialog until it opens.
 */
export interface ConstitutionDialogBodyProps {
  record: ConstitutionRecord;
  gates: readonly GateNotification[];
  view: ConstitutionView;
  onViewChange: (view: ConstitutionView) => void;
}

const VIEWS: ConstitutionView[] = ["user", "developer"];

export function ConstitutionDialogBody({
  record,
  gates,
  view,
  onViewChange,
}: ConstitutionDialogBodyProps) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const viewLabel: Record<ConstitutionView, string> = {
    user: t.constitution.view.user,
    developer: t.constitution.view.developer,
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t.constitution.title}
        className="bg-muted/60 flex w-fit gap-1 rounded-md p-0.5"
      >
        {VIEWS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            data-testid={`constitution-view-${candidate}`}
            aria-selected={view === candidate}
            className={cn(
              "rounded px-2 py-1 text-xs transition-colors",
              view === candidate
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewChange(candidate)}
          >
            {viewLabel[candidate]}
          </button>
        ))}
      </div>

      {view === "user" ? (
        <ConstitutionUserView
          stages={record.stages}
          gates={gates}
          selectedKey={selectedKey}
          onSelectStage={setSelectedKey}
        />
      ) : (
        <ConstitutionDeveloperView
          record={record}
          gates={gates}
          selectedKey={selectedKey}
          onSelectStage={setSelectedKey}
        />
      )}
    </div>
  );
}
