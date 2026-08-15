/**
 * TanStack Query hooks for the knowledge API. Polling cadence lives in the
 * pure `documentsRefetchInterval` (document-stats.ts) so the wiring here
 * stays trivially testable.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "./api";
import { documentsRefetchInterval } from "./document-stats";

export function knowledgeBasesKey() {
  return ["knowledge-bases"] as const;
}

export function knowledgeDocumentsKey(kbId: string) {
  return ["knowledge-bases", kbId, "documents"] as const;
}

export function knowledgeChunksKey(kbId: string, docId: string, offset: number, limit: number) {
  return ["knowledge-bases", kbId, "documents", docId, "chunks", { offset, limit }] as const;
}

export function useKnowledgeBases() {
  return useQuery({ queryKey: knowledgeBasesKey(), queryFn: api.listKnowledgeBases });
}

export function supportedFormatsKey() {
  return ["knowledge-bases", "supported-formats"] as const;
}

/** Upload allowlist (Task 6): static data — never goes stale within a session. */
export function useSupportedFormats() {
  return useQuery({
    queryKey: supportedFormatsKey(),
    queryFn: api.getSupportedFormats,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createKnowledgeBase,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
    },
  });
}

export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, patch }: { kbId: string; patch: { name?: string; description?: string } }) =>
      api.updateKnowledgeBase(kbId, patch),
    onSuccess: (_data, { kbId }) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => api.deleteKnowledgeBase(kbId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeBasesKey() });
    },
  });
}

export function useDocuments(kbId: string | null) {
  return useQuery({
    queryKey: knowledgeDocumentsKey(kbId ?? ""),
    queryFn: () => api.listDocuments(kbId!),
    enabled: kbId !== null,
    refetchInterval: (query) => documentsRefetchInterval(query.state.data),
  });
}

export function useUploadDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadDocument(kbId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDeleteDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.deleteDocument(kbId, docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useRetryDocument(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.retryDocument(kbId, docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeDocumentsKey(kbId) });
    },
  });
}

export function useDocumentChunks(kbId: string | null, docId: string | null, offset: number, limit: number) {
  return useQuery({
    queryKey: knowledgeChunksKey(kbId ?? "", docId ?? "", offset, limit),
    queryFn: () => api.listDocumentChunks(kbId!, docId!, { offset, limit }),
    enabled: kbId !== null && docId !== null,
  });
}

export function useGenerateWiki(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: api.WikiGenerateMode) => api.generateWiki(kbId, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
    },
  });
}

export function knowledgeWikiEntriesKey(kbId: string) {
  return ["knowledge-bases", kbId, "wiki-entries"] as const;
}

/**
 * Wiki tab listing (phase-2 batch-1). Lazy: the caller gates with
 * ``enabled`` so the list only loads once the tab is first activated —
 * keep-alive panes stay mounted, so without the gate every tab would fetch
 * eagerly.
 */
export function useWikiEntries(kbId: string | null, enabled = true) {
  return useQuery({
    queryKey: knowledgeWikiEntriesKey(kbId ?? ""),
    queryFn: () => api.listWikiEntries(kbId!),
    enabled: enabled && kbId !== null,
  });
}

/** Full entry text for the drawer; null-gated until the drawer opens. */
export function useWikiEntry(kbId: string | null, entryId: string | null) {
  return useQuery({
    queryKey: [...knowledgeWikiEntriesKey(kbId ?? ""), entryId ?? ""] as const,
    queryFn: () => api.getWikiEntry(kbId!, entryId!),
    enabled: kbId !== null && entryId !== null,
  });
}

/**
 * Manual single-entry delete (Task 13). Regeneration semantics: an eligible
 * entity's entry comes back on the next generation run (a reset); only
 * disqualified/vanished entities' entries stay deleted.
 */
export function useDeleteWikiEntry(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.deleteWikiEntry(kbId, entryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
    },
  });
}

/** Phase-3 Batch-1 P1: update wiki entry (main content + supplement layer). */
export function useUpdateWikiEntry(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: { content: string; supplement_content: string | null } }) =>
      api.updateWikiEntry(kbId, entryId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeWikiEntriesKey(kbId) });
    },
  });
}

/** Phase-3 Batch-1 P2: update chunk text with re-embedding. */
export function useUpdateChunk(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chunkId, body }: { chunkId: string; body: { text: string } }) => api.updateChunk(kbId, chunkId, body),
    onSuccess: () => {
      // Invalidate all chunk queries for this KB (any doc might contain this chunk)
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kbId, "documents"] });
    },
  });
}

/** Phase-3 Batch-1 P5: preview chunk deletion impact (dry-run). */
export function usePreviewChunkDeletion(kbId: string) {
  return useMutation({
    mutationFn: (body: { chunk_ids: string[] }) => api.previewChunkDeletion(kbId, body),
  });
}

/** Phase-3 Batch-1 P3: re-extract entities for a single chunk. */
export function useReExtractChunk(kbId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chunkId: string) => api.reExtractChunk(kbId, chunkId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kbId, "documents"] });
    },
  });
}

/**
 * P1 recall test (phase-2 batch-1): a mutation, not a query — each run hits
 * the live retrieval chain (embedding + rerank + entity-extraction LLM), so
 * results must never be cached/refetched implicitly.
 */
export function useRecallTest(kbId: string) {
  return useMutation({
    mutationFn: (body: { query: string; top_k: number }) => api.recallTest(kbId, body),
  });
}
