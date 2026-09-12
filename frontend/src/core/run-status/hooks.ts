import { useQuery } from "@tanstack/react-query";

import { getAPIClient } from "@/core/api";

import { classifyRunOutcome } from "./classify";
import { parseRunOutcome } from "./parse";
import type { RunOutcomeView } from "./types";

/**
 * The outcome is a terminal fact — written when the run ends and never changed
 * after — so it is fetched once. The placeholder is kept only while the same
 * thread stays open, matching the `useDelivery` hook this sits beside: two
 * consecutive runs would otherwise blink the notice out and back in.
 */
function keepSameThread<T>(
  previousData: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  threadId: string | null | undefined,
): T | undefined {
  return previousQuery?.queryKey[1] === threadId ? previousData : undefined;
}

export const runOutcomeQueryKey = (
  threadId: string | null | undefined,
  runId: string | null | undefined,
) => ["run-status", threadId, runId] as const;

export function useRunOutcome({
  threadId,
  runId,
  enabled = true,
}: {
  threadId: string | null | undefined;
  runId: string | null | undefined;
  enabled?: boolean;
}) {
  return useQuery<RunOutcomeView | null>({
    queryKey: runOutcomeQueryKey(threadId, runId),
    queryFn: async () => {
      if (!threadId || !runId) {
        return null;
      }
      const outcome = parseRunOutcome(
        await getAPIClient().runs.get(threadId, runId),
      );
      if (outcome === null) {
        return null;
      }
      return { outcome, ...classifyRunOutcome(outcome) };
    },
    // Callers hold this off while a run is in flight. `staleTime: Infinity`
    // caches the answer for the run's lifetime, so a read taken mid-run would
    // freeze a `running` status and never judge the real outcome at all.
    enabled: enabled && Boolean(threadId && runId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData, previousQuery) =>
      keepSameThread(previousData, previousQuery, threadId),
  });
}
