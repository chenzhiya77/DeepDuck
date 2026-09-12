import { readStartFailure } from "../run-status/start-failure";

import type { MessageGroup } from "./utils";

/**
 * Locate the one message that owns a failed start's notice.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.1 — the notice renders under the reader's own turn, because there is no run
 * to hang it on: the run was never created.
 *
 * The spec words this as "the last human message, and only when nothing follows
 * it", reading a later assistant or tool message as proof the run did start. The
 * verdict carried by the message settles it instead, and that is strictly
 * stronger than the structural test rather than a replacement for it: the marker
 * is written only onto a send that never produced a run, so a marked message
 * cannot have that run's output after it — and unlike the structural rule it
 * refuses an ordinary trailing user turn, which is the case that matters.
 * Anchoring one of those would put this failure under a turn that never failed.
 *
 * Returns group indices for the same reason the workspace-change helper does: the
 * render site is a group, and the message's own id may be absent.
 */
export function getStartFailureAnchorGroupIndices(
  groups: MessageGroup[],
): Set<number> {
  const anchors = new Set<number>();

  groups.forEach((group, groupIndex) => {
    if (group.type !== "human") {
      return;
    }
    if (group.messages.some((message) => readStartFailure(message) !== null)) {
      anchors.add(groupIndex);
    }
  });

  return anchors;
}
