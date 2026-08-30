/**
 * Doc failure notifications (2026-08-30): errors never live in the table.
 * When polling observes documents transition into ``failed``, ONE aggregated
 * toast fires — same-cycle failures fold into a single dismissible entry
 * (Drive/Explorer summary style, sonner auto-expires). A document is
 * announced once per failure episode; already-failed rows at first load
 * never backfire; a retry that fails again re-announces.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeDocument } from "@/core/knowledge/types";

import { classifyDocError } from "./doc-errors";

export function useDocFailureToasts(documents: KnowledgeDocument[] | undefined) {
  const { t } = useI18n();
  // Failure episodes already announced; a doc leaving ``failed`` (user retry)
  // clears its record so the NEXT failure re-announces.
  const notified = useRef(new Set<string>());
  const initialized = useRef(false);

  useEffect(() => {
    if (!documents) return;
    const tk = t.knowledge.docErrors;
    for (const doc of documents) {
      if (doc.status !== "failed") notified.current.delete(doc.id);
    }
    if (!initialized.current) {
      // First snapshot: pre-mark existing failures — history never re-toasts.
      for (const doc of documents) {
        if (doc.status === "failed") notified.current.add(doc.id);
      }
      initialized.current = true;
      return;
    }
    const fresh = documents.filter((doc) => doc.status === "failed" && !notified.current.has(doc.id));
    if (fresh.length === 0) return;
    for (const doc of fresh) notified.current.add(doc.id);
    // Same-cycle failures fold into one summary toast: 文件名：友好原因.
    const description = fresh.map((doc) => `${doc.name}：${tk[classifyDocError(doc.error)]}`).join("；");
    toast.error(tk.toastTitle, { description });
  }, [documents, t]);
}
