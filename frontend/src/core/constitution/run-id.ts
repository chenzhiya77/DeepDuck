/**
 * Which run the constitution view describes.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.1.
 * The live id comes from the stream (`onStart`); a reloaded page has none, so we
 * fall back to the newest run the visible messages were built from.
 */
export function resolveRunId(
  liveRunId: string | null | undefined,
  messages: readonly { run_id?: string | null }[],
): string | null {
  if (liveRunId) {
    return liveRunId;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const runId = messages[index]?.run_id;
    if (runId) {
      return runId;
    }
  }
  return null;
}
