import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
  loadModels,
  loadModelsConfig,
  ModelsConfigRequestError,
  saveModelsConfig,
} from "./api";
import type { ManagedModelInput } from "./types";

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: () => loadModels(),
    enabled,
    refetchOnWindowFocus: false,
    // Model config changes rarely and every subtask card mounts its own
    // observer of this query; without a staleTime each newly-mounted card would
    // refetch /api/models on mount (default staleTime: 0). Treat the list as
    // fresh for the session so a long conversation with many cards issues one
    // request, not one per card.
    staleTime: Infinity,
  });
  return {
    models: data?.models ?? [],
    tokenUsageEnabled: data?.token_usage.enabled ?? false,
    isLoading,
    error,
  };
}

// ── Admin models management (spec 2026-09-10 §5.5) ───────────────────────

export function useModelsConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["modelsConfig"],
    queryFn: () => loadModelsConfig(),
    retry: (count, error) =>
      !(error instanceof ModelsConfigRequestError) && count < 3,
  });
  return { config: data, isLoading, error };
}

export function useSaveModelsConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (models: ManagedModelInput[]) => saveModelsConfig(models),
    onSuccess: () => {
      // Refresh both the admin list and the chat model selector (the public
      // GET /api/models reflects the merged set after the config hot-reload).
      void queryClient.invalidateQueries({ queryKey: ["modelsConfig"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
