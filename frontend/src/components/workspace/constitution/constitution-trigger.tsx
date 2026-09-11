"use client";

import { WorkflowIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import type {
  ConstitutionRecord,
  ConstitutionView,
  GateNotification,
} from "@/core/constitution/types";
import { useI18n } from "@/core/i18n/hooks";
import { useLocalSettings } from "@/core/settings";
import { cn } from "@/lib/utils";

import { ConstitutionDialog } from "./constitution-dialog";

/**
 * The header's way into the harness view.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §12.1.
 * Icon-only, like `SidecarTrigger` in the same cluster: the frozen copy table has
 * no short label for this control (its `title` is a sentence, and every other
 * header label is two to four characters), and this cluster is the one the spec
 * flagged as at risk of crowding on narrow screens. The name lives in the
 * `aria-label` and the tooltip instead.
 *
 * Rendered only when there is a snapshot: a run predating the feature, a custom
 * agent factory, or an embedded client leaves nothing to show, and a button that
 * opens an empty dialog is worse than no button. That also means no empty state
 * needs its own copy.
 */
export interface ConstitutionTriggerProps {
  record: ConstitutionRecord | null | undefined;
  gates: readonly GateNotification[];
  className?: string;
}

export function ConstitutionTrigger({
  record,
  gates,
  className,
}: ConstitutionTriggerProps) {
  const { t } = useI18n();
  const [localSettings, setLocalSettings] = useLocalSettings();
  const [open, setOpen] = useState(false);

  if (!record) {
    return null;
  }

  const view: ConstitutionView = localSettings.constitution.view;

  return (
    <>
      <Tooltip content={t.constitution.title}>
        <Button
          aria-label={t.constitution.title}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            className,
          )}
          variant="ghost"
          data-testid="constitution-trigger"
          onClick={() => setOpen(true)}
        >
          <WorkflowIcon />
        </Button>
      </Tooltip>
      <ConstitutionDialog
        open={open}
        onOpenChange={setOpen}
        record={record}
        gates={gates}
        view={view}
        onViewChange={(next) =>
          setLocalSettings("constitution", { view: next })
        }
      />
    </>
  );
}
