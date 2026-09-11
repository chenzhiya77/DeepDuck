import { expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings/local";
import { useThreadStream } from "@/core/threads/hooks";

/**
 * The live run id, exposed for run-scoped reads.
 *
 * The constitution view fetches per run, so it needs the id of the run that is
 * going **now**. `onStart` cannot supply it: `handleStreamStart` forwards to that
 * listener only once per thread, so a second run in the same thread never
 * reaches it. `onCreated` fires per run, which is what this pins.
 */
const streamMockState = rs.hoisted(() => ({
  onCreated: undefined as
    | ((meta: { thread_id: string; run_id: string }) => void)
    | undefined,
  stop: rs.fn(async () => undefined),
  submit: rs.fn(async () => undefined),
}));

rs.mock("@langchain/langgraph-sdk/react", () => ({
  useStream: (options: {
    onCreated?: (meta: { thread_id: string; run_id: string }) => void;
  }) => {
    streamMockState.onCreated = options.onCreated;
    return {
      isLoading: false,
      messages: [],
      stop: streamMockState.stop,
      submit: streamMockState.submit,
      values: { artifacts: [], messages: [], title: "", todos: [] },
    };
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      I18nContext.Provider,
      { value: { locale: "en-US", setLocale: () => undefined, t: enUS } },
      children,
    ),
  );
}

function renderThreadStream(threadId: string | undefined) {
  return renderHook(
    ({ id }: { id: string | undefined }) =>
      useThreadStream({
        context: DEFAULT_LOCAL_SETTINGS.context,
        isMock: true,
        threadId: id,
      }),
    { wrapper, initialProps: { id: threadId } },
  );
}

test("tracks the run id of every run, not just the thread's first", () => {
  const { result } = renderThreadStream("thread-1");

  expect(result.current.liveRunId).toBeNull();

  act(() => {
    streamMockState.onCreated?.({ thread_id: "thread-1", run_id: "run-1" });
  });
  expect(result.current.liveRunId).toBe("run-1");

  // The second run in the same thread must replace it: this is the case
  // `onStart` never sees.
  act(() => {
    streamMockState.onCreated?.({ thread_id: "thread-1", run_id: "run-2" });
  });
  expect(result.current.liveRunId).toBe("run-2");
});

test("drops the live run id when the view moves to another thread", () => {
  const { result, rerender } = renderThreadStream("thread-1");

  act(() => {
    streamMockState.onCreated?.({ thread_id: "thread-1", run_id: "run-1" });
  });
  expect(result.current.liveRunId).toBe("run-1");

  rerender({ id: "thread-2" });
  expect(result.current.liveRunId).toBeNull();
});
