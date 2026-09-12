"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useRunOutcome } from "@/core/run-status/hooks";
import { readStartFailure } from "@/core/run-status/start-failure";
import type { FailureAction, FailureKind } from "@/core/run-status/types";

/**
 * Why a run did not start (or did not finish), and what to do about it.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.1/§4.2. One component serves both anchors — the reader's own turn for a start
 * that failed, the run's last answer bubble for a run that failed — because the
 * two are the same thing to the reader and only the position differs.
 *
 * The sentence carries the instruction. That is how the copy was written
 * ("…wait for it or stop it", "…pick another"), and it is why only one action has
 * a control here: the stop button and the model picker are already on screen in
 * the composer, and restarting a service has no in-page destination at all.
 * `inspect` is the exception — the backend's own `error` text is otherwise
 * invisible, so it gets a disclosure. A "back to the list" link for a gone chat
 * would genuinely help too, but it needs routing inside the message tree; that is
 * a browser-leg decision, not one to guess at here.
 */

/**
 * Which kinds state their own sentence here.
 *
 * `runFailed` is the exception, and it is why this line is a component of its own
 * rather than a second copy of the badge: its sentence ("this run didn't finish")
 * is what the badge already says on the line directly above, so repeating it here
 * would print the same sentence twice. What the badge cannot say is *why* — and
 * that, the backend's own error text, is exactly what this line adds, behind a
 * disclosure.
 *
 * `stopped` and `none` say nothing at all: a stopped run is the badge's story,
 * and `none` covers success, a run in flight, and the two frontend-bug statuses.
 */
type SentenceKey = "busy" | "modelNotAllowed" | "threadGone" | "modeMismatch";

/**
 * Where the gone-chat sentence sends the reader.
 *
 * A single target on purpose: the conversations list is the one surface every
 * layer of the app can reach. A knowledge-base thread's own list lives under
 * `/workspace/knowledge`, so this lands a kb reader one hop away rather than at
 * their own list — recorded as a known limit instead of guessed at, because the
 * notice cannot tell which surface it was rendered on.
 */
const CHAT_LIST_HREF = "/workspace/chats";

const SENTENCE_KEY: Record<FailureKind, SentenceKey | null> = {
  occupied: "busy",
  config: "modelNotAllowed",
  environment: "threadGone",
  modeMismatch: "modeMismatch",
  runFailed: null,
  stopped: null,
  none: null,
};

export function RunStatusNotice({
  kind,
  action,
  details,
}: {
  kind: FailureKind;
  action: FailureAction | null;
  /** The backend's own text (a run that failed) or the caught error's (a start
   *  that failed). Null when there is nothing verbatim to show. */
  details?: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const sentenceKey = SENTENCE_KEY[kind];
  const sentence = sentenceKey === null ? null : t.runOutcome[sentenceKey];
  const openable = action === "inspect" && Boolean(details);

  if (sentence === null && !openable) {
    return null;
  }

  return (
    <div
      data-testid="run-status-notice"
      data-kind={kind}
      className="border-border/70 text-destructive mt-2 flex flex-col gap-1.5 border-l-2 pl-2.5 text-xs"
    >
      {sentence !== null && (
        <p className="flex items-center gap-1.5">
          <CircleAlert className="size-3.5 shrink-0" />
          {kind === "environment" ? (
            // The sentence already says "start again from the list", so it *is*
            // the control for this kind: a link, no new copy, and the reader can
            // act on it where they read it.
            <Link
              href={CHAT_LIST_HREF}
              data-testid="run-status-list-link"
              className="underline underline-offset-2"
            >
              {sentence}
            </Link>
          ) : (
            <span>{sentence}</span>
          )}
        </p>
      )}
      {openable && (
        <div className="text-muted-foreground">
          <button
            type="button"
            data-testid="run-status-details-toggle"
            className="hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {t.runOutcome.details}
          </button>
          {open && (
            <pre className="border-border/70 mt-1.5 max-h-40 overflow-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre-wrap">
              {details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The notice for a run that ended: its "why" is the backend's own `error`, which
 * nothing else on the page shows.
 */
export function RunStatusNoticeForRun({
  threadId,
  runId,
  enabled = true,
}: {
  threadId: string;
  runId?: string;
  enabled?: boolean;
}) {
  const { data } = useRunOutcome({
    threadId,
    runId,
    enabled: enabled && Boolean(runId),
  });

  if (!data) {
    return null;
  }
  return (
    <RunStatusNotice
      kind={data.kind}
      action={data.action}
      details={data.outcome.error}
    />
  );
}

/**
 * The notice for a send whose run never started, read off the reader's own
 * message — the one the failed start kept back and marked.
 */
export function RunStatusNoticeFromMessage({ message }: { message: unknown }) {
  const notice = readStartFailure(message);

  if (notice === null) {
    return null;
  }
  return (
    <RunStatusNotice
      kind={notice.kind}
      action={notice.action}
      details={notice.message}
    />
  );
}
