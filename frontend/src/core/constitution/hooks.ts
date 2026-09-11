import { useQuery } from "@tanstack/react-query";

import { fetchConstitution, fetchGateEvents } from "./api";
import type { ConstitutionRecord, GateNotification } from "./types";

/**
 * The snapshot does not change within a run, so it is fetched once and never
 * refetched on focus. The placeholder is kept only while the same thread stays
 * open: two consecutive runs would otherwise blink the trigger out and back in,
 * while a thread switch must never show the previous chat's harness.
 */
function keepSameThread<T>(
  previousData: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  threadId: string | null | undefined,
): T | undefined {
  return previousQuery?.queryKey[1] === threadId ? previousData : undefined;
}

export const constitutionQueryKey = (
  threadId: string | null | undefined,
  runId: string | null | undefined,
) => ["constitution", threadId, runId] as const;

export const gateEventsQueryKey = (
  threadId: string | null | undefined,
  runId: string | null | undefined,
) => ["gate-events", threadId, runId] as const;

export function useConstitution(
  threadId: string | null | undefined,
  runId: string | null | undefined,
) {
  return useQuery<ConstitutionRecord | null>({
    queryKey: constitutionQueryKey(threadId, runId),
    queryFn: async () => {
      if (!threadId || !runId) {
        return null;
      }
      return fetchConstitution(threadId, runId);
    },
    enabled: Boolean(threadId && runId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData, previousQuery) =>
      keepSameThread(previousData, previousQuery, threadId),
  });
}

export function useGateEvents(
  threadId: string | null | undefined,
  runId: string | null | undefined,
) {
  return useQuery<GateNotification[]>({
    queryKey: gateEventsQueryKey(threadId, runId),
    queryFn: async () => {
      if (!threadId || !runId) {
        return [];
      }
      return fetchGateEvents(threadId, runId);
    },
    enabled: Boolean(threadId && runId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData, previousQuery) =>
      keepSameThread(previousData, previousQuery, threadId),
  });
}
