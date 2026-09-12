import { expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { START_FAILURE_KWARG } from "@/core/run-status/start-failure";
import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings/local";

/**
 * A failed start keeps the reader's own message, and rides the verdict on it.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md
 * §4.1/§4.3. The failure notice anchors on the user's message, so the message has
 * to survive the failure — today it is cleared along with everything optimistic,
 * which leaves the notice nothing to render under (and leaves a brand-new chat
 * with no anchor at all). The same handler must NOT change what an unclassified
 * error does, which is the second case here.
 */
const streamMockState = rs.hoisted(() => ({
  onError: undefined as ((error: unknown) => void) | undefined,
  onCreated: undefined as
    | ((meta: { thread_id: string; run_id: string }) => void)
    | undefined,
  submit: rs.fn(async () => undefined),
}));

rs.mock("@langchain/langgraph-sdk/react", () => ({
  useStream: (options: {
    onError?: (error: unknown) => void;
    onCreated?: (meta: { thread_id: string; run_id: string }) => void;
  }) => {
    streamMockState.onError = options.onError;
    streamMockState.onCreated = options.onCreated;
    return {
      isLoading: false,
      messages: [],
      stop: rs.fn(async () => undefined),
      submit: streamMockState.submit,
      values: {
        artifacts: [],
        messages: [],
        title: "",
        todos: [],
      },
    };
  },
}));

/** The SDK's `HTTPError`: an `Error` with the numeric status attached. */
const httpError = (status: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), { status });

async function renderThreadStream() {
  const { useThreadStream } = await import("@/core/threads/hooks");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        I18nContext.Provider,
        { value: { locale: "en-US", setLocale: () => undefined, t: enUS } },
        children,
      ),
    );
  return renderHook(
    () =>
      useThreadStream({
        context: DEFAULT_LOCAL_SETTINGS.context,
        isMock: true,
        threadId: "thread-1",
      }),
    { wrapper },
  );
}

test("keeps the sent message and rides the verdict on it when the start fails", async () => {
  const { rerender, result } = await renderThreadStream();

  await act(async () => {
    await result.current.sendMessage("thread-1", {
      files: [],
      text: "Hello there",
    });
  });

  act(() => {
    streamMockState.onError?.(httpError(409));
    rerender();
  });

  const messages = result.current.thread.messages;
  expect(messages).toHaveLength(1);
  expect(messages[0]?.type).toBe("human");
  expect(messages[0]?.additional_kwargs?.[START_FAILURE_KWARG]).toEqual({
    kind: "occupied",
    action: "stop",
    message: "HTTP 409",
  });
});

test("still clears everything when the error carries no status", async () => {
  const { rerender, result } = await renderThreadStream();

  await act(async () => {
    await result.current.sendMessage("thread-1", {
      files: [],
      text: "Hello there",
    });
  });

  act(() => {
    streamMockState.onError?.(new Error("boom"));
    rerender();
  });

  expect(result.current.thread.messages).toEqual([]);
});
