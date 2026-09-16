import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
  loadRagConfig,
  probeEmbeddingCapability,
  RagConfigRequestError,
  saveRagConfig,
} from "./api";
import type { SparseProbeVerdict } from "./config-form";
import type { RagConfigInput, RagSparseProbeRequest } from "./types";

/**
 * TanStack Query bindings for the admin RAG functional-model view
 * (spec 2026-09-10 rag functional-model config §5).
 *
 * A 403 is a state the view renders (non-admin), not a transient failure, so it is not
 * retried — same rule the models config query uses.
 */

export function useRagConfig({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ragConfig"],
    queryFn: () => loadRagConfig(),
    enabled,
    // The form is seeded from this view; a focus refetch must not clobber edits.
    refetchOnWindowFocus: false,
    retry: (count, error) => !(error instanceof RagConfigRequestError) && count < 3,
  });
  return { view: data, isLoading, error };
}

export function useSaveRagConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RagConfigInput) => saveRagConfig(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ragConfig"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

/** The probe's input: the candidate configuration, plus the key it was taken for. */
export type SparseProbeInput = RagSparseProbeRequest & { key: string };

/**
 * One model-level capability probe (spec 2026-09-16 §3 D3/D4.2).
 *
 * The verdict is returned together with `key`, the values it describes: the view must never apply
 * a conclusion to a form it was not taken for. It deliberately does not invalidate the config
 * query — nothing was written — and failures are left to the caller: a probe that could not
 * answer is a state the row renders (`unverifiable`), not a toast to dismiss.
 */
export function useProbeSparseCapability() {
  return useMutation({
    mutationFn: async ({
      key,
      ...request
    }: SparseProbeInput): Promise<SparseProbeVerdict> => {
      const verdict = await probeEmbeddingCapability(request);
      return { key, status: verdict.status };
    },
  });
}
