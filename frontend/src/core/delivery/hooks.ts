import { useQuery } from "@tanstack/react-query";

import { fetchDelivery } from "./api";
import type { DeliveryReceipt } from "./types";

/**
 * The receipt is a terminal fact — it is written when the run ends and never
 * changes after — so it is fetched once. The placeholder is kept only while the
 * same thread stays open, matching `useWorkspaceChanges`'s neighbour: two
 * consecutive runs would otherwise blink the line out and back in.
 */
function keepSameThread<T>(
  previousData: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  threadId: string | null | undefined,
): T | undefined {
  return previousQuery?.queryKey[1] === threadId ? previousData : undefined;
}

export const deliveryQueryKey = (
  threadId: string | null | undefined,
  runId: string | null | undefined,
) => ["delivery", threadId, runId] as const;

export function useDelivery(
  threadId: string | null | undefined,
  runId: string | null | undefined,
) {
  return useQuery<DeliveryReceipt | null>({
    queryKey: deliveryQueryKey(threadId, runId),
    queryFn: async () => {
      if (!threadId || !runId) {
        return null;
      }
      return fetchDelivery(threadId, runId);
    },
    enabled: Boolean(threadId && runId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData, previousQuery) =>
      keepSameThread(previousData, previousQuery, threadId),
  });
}
