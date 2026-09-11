"use client";

import dynamic from "next/dynamic";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ConstitutionRecord,
  ConstitutionView,
  GateNotification,
} from "@/core/constitution/types";
import { useI18n } from "@/core/i18n/hooks";

/**
 * The harness view, opened from the header.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.3/§12.1.
 * A Dialog rather than a right-hand panel: the three side panels are mutually
 * exclusive, so a fourth would evict the artifacts/browser/sidecar the user is
 * already using. The body is code-split — the ring and both tiers are only
 * fetched once this is opened.
 */
const ConstitutionDialogBody = dynamic(
  () =>
    import("./constitution-dialog-body").then(
      (module) => module.ConstitutionDialogBody,
    ),
  { ssr: false },
);

export interface ConstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ConstitutionRecord;
  gates: readonly GateNotification[];
  view: ConstitutionView;
  onViewChange: (view: ConstitutionView) => void;
}

export function ConstitutionDialog({
  open,
  onOpenChange,
  record,
  gates,
  view,
  onViewChange,
}: ConstitutionDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.constitution.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.constitution.title}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ConstitutionDialogBody
            record={record}
            gates={gates}
            view={view}
            onViewChange={onViewChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
