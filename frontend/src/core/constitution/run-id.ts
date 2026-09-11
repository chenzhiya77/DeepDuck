/**
 * Which run the constitution view describes.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.1.
 * The live id comes from the stream (`onCreated`); a reloaded page has none, so
 * we fall back to the newest run the visible messages were built from. History
 * rows carry `run_id`; the SDK's `Message` type does not model it, so it is read
 * defensively rather than asserted.
 */
function runIdOf(message: unknown): string | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const runId = (message as { run_id?: unknown }).run_id;
  return typeof runId === "string" && runId !== "" ? runId : null;
}

export function resolveRunId(
  liveRunId: string | null | undefined,
  messages: readonly unknown[],
): string | null {
  if (liveRunId) {
    return liveRunId;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const runId = runIdOf(messages[index]);
    if (runId !== null) {
      return runId;
    }
  }
  return null;
}
