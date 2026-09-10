import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { loadRagConfig, RagConfigRequestError, saveRagConfig } from "./api";
import type { RagConfigInput } from "./types";

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
