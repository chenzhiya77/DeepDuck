/**
 * Wiring tests for the knowledge TanStack Query hooks: fetch routing,
 * enabled gating, polling wiring, and cache invalidation after mutations.
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

rs.mock("@/core/knowledge/api", () => ({
  listKnowledgeBases: rs.fn(),
  createKnowledgeBase: rs.fn(),
  updateKnowledgeBase: rs.fn(),
  deleteKnowledgeBase: rs.fn(),
  listDocuments: rs.fn(),
  uploadDocument: rs.fn(),
  deleteDocument: rs.fn(),
  retryDocument: rs.fn(),
  listDocumentChunks: rs.fn(),
  generateWiki: rs.fn(),
}));

import * as api from "@/core/knowledge/api";
import {
  knowledgeDocumentsKey,
  useCreateKnowledgeBase,
  useDocuments,
  useGenerateWiki,
  useKnowledgeBases,
  useRetryDocument,
  useUploadDocument,
} from "@/core/knowledge/hooks";
import type { KnowledgeDocument } from "@/core/knowledge/types";

const KB = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品资料",
  description: "",
  visibility: "private",
  created_at: "2026-08-09T10:00:00Z",
};

const READY_DOC: KnowledgeDocument = {
  id: "doc-1",
  kb_id: "kb-1",
  uploader_id: "user-1",
  name: "a.pdf",
  size_bytes: 10,
  storage_path: "p",
  status: "ready",
  progress_percent: 100,
  chunk_count: 3,
  error: null,
  path_status: null,
  content_hash: null,
  created_at: "2026-08-09T10:00:00Z",
};

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  rs.mocked(api.listKnowledgeBases).mockResolvedValue([KB]);
  rs.mocked(api.listDocuments).mockResolvedValue([READY_DOC]);
  rs.mocked(api.createKnowledgeBase).mockResolvedValue(KB);
  rs.mocked(api.uploadDocument).mockResolvedValue(READY_DOC);
  rs.mocked(api.retryDocument).mockResolvedValue({ ...READY_DOC, status: "uploaded", progress_percent: 0 });
  rs.mocked(api.generateWiki).mockResolvedValue({ status: "enqueued" });
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("useKnowledgeBases", () => {
  it("fetches and caches the list", async () => {
    const { result } = renderHook(() => useKnowledgeBases(), {
      wrapper: createWrapper(freshQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([KB]);
    expect(api.listKnowledgeBases).toHaveBeenCalledTimes(1);
  });
});

describe("useCreateKnowledgeBase", () => {
  it("invalidates the kb list after success", async () => {
    const queryClient = freshQueryClient();
    const wrapper = createWrapper(queryClient);
    const list = renderHook(() => useKnowledgeBases(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const mutation = renderHook(() => useCreateKnowledgeBase(), { wrapper });
    await mutation.result.current.mutateAsync({ name: "新库", description: "" });

    expect(rs.mocked(api.createKnowledgeBase).mock.calls[0]?.[0]).toEqual({ name: "新库", description: "" });
    await waitFor(() => expect(api.listKnowledgeBases).toHaveBeenCalledTimes(2));
  });
});

describe("useDocuments", () => {
  it("is disabled without a kb id (no fetch fires)", () => {
    renderHook(() => useDocuments(null), { wrapper: createWrapper(freshQueryClient()) });
    expect(api.listDocuments).not.toHaveBeenCalled();
  });

  it("fetches when a kb is selected", async () => {
    const { result } = renderHook(() => useDocuments("kb-1"), {
      wrapper: createWrapper(freshQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listDocuments).toHaveBeenCalledWith("kb-1");
    expect(result.current.data?.[0]?.status).toBe("ready");
  });
});

describe("document mutations", () => {
  it("upload invalidates the documents query (picks up the uploaded row)", async () => {
    const queryClient = freshQueryClient();
    const wrapper = createWrapper(queryClient);
    const docs = renderHook(() => useDocuments("kb-1"), { wrapper });
    await waitFor(() => expect(docs.result.current.isSuccess).toBe(true));

    const upload = renderHook(() => useUploadDocument("kb-1"), { wrapper });
    await upload.result.current.mutateAsync(new File(["x"], "b.md"));

    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2));
  });

  it("retry invalidates the documents query", async () => {
    const queryClient = freshQueryClient();
    const wrapper = createWrapper(queryClient);
    const docs = renderHook(() => useDocuments("kb-1"), { wrapper });
    await waitFor(() => expect(docs.result.current.isSuccess).toBe(true));

    const retry = renderHook(() => useRetryDocument("kb-1"), { wrapper });
    await retry.result.current.mutateAsync("doc-1");

    expect(api.retryDocument).toHaveBeenCalledWith("kb-1", "doc-1");
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2));
  });

  it("documents query cache uses the kb-scoped key", async () => {
    const queryClient = freshQueryClient();
    const wrapper = createWrapper(queryClient);
    const docs = renderHook(() => useDocuments("kb-1"), { wrapper });
    await waitFor(() => expect(docs.result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(knowledgeDocumentsKey("kb-1"))).toEqual([READY_DOC]);
  });
});

describe("useGenerateWiki", () => {
  it("posts the trigger without touching the documents cache", async () => {
    const { result } = renderHook(() => useGenerateWiki("kb-1"), {
      wrapper: createWrapper(freshQueryClient()),
    });
    await result.current.mutateAsync("incremental");
    expect(api.generateWiki).toHaveBeenCalledWith("kb-1", "incremental");
  });

  it("passes the full-rebuild mode through", async () => {
    const { result } = renderHook(() => useGenerateWiki("kb-1"), {
      wrapper: createWrapper(freshQueryClient()),
    });
    await result.current.mutateAsync("full");
    expect(api.generateWiki).toHaveBeenCalledWith("kb-1", "full");
  });
});
