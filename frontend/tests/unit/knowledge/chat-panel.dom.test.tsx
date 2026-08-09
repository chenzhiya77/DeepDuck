/**
 * Right-column knowledge chat panel (spec §4.5/§4.6/§4.7/§5.2): binds the
 * current kb via ``context.kb_id`` + ``agent_name: "rag"``, isolates its
 * threads behind ``metadata.kb_id``, offers a kb-scoped history popover, a
 * deep-retrieval toggle, citation footers, and an expand-to-full-page entry.
 */
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUseThreadStream = rs.fn();
const mockUseInfiniteThreads = rs.fn();
const mockSendMessage = rs.fn();

rs.mock("@/core/threads/hooks", () => ({
  useThreadStream: (options: unknown) => mockUseThreadStream(options),
  useInfiniteThreads: (params?: unknown) => mockUseInfiniteThreads(params),
}));

let capturedMessageListProps: Record<string, unknown> | null = null;

rs.mock("@/components/workspace/messages", () => ({
  MessageList: (props: Record<string, unknown>) => {
    capturedMessageListProps = props;
    return <div data-testid="message-list" />;
  },
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM: 120,
}));

import { KnowledgeChatPanel } from "@/components/workspace/knowledge/chat-panel";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeBase } from "@/core/knowledge/types";

const KB: KnowledgeBase = {
  id: "kb-1",
  owner_id: "user-1",
  name: "产品知识库",
  description: "",
  visibility: "private",
  created_at: "2026-08-01T10:00:00Z",
};

function makeThread(threadId: string, kbId: string | null, title: string) {
  return {
    thread_id: threadId,
    created_at: "2026-08-09T09:00:00Z",
    updated_at: "2026-08-09T10:00:00Z",
    status: "idle",
    metadata: kbId ? { kb_id: kbId } : {},
    values: { title, messages: [] },
  };
}

const KB_THREAD = makeThread("thread-kb1-a", "kb-1", "如何上传文档");
const OTHER_KB_THREAD = makeThread("thread-kb2-a", "kb-2", "别的库会话");
const PLAIN_THREAD = makeThread("thread-plain", null, "普通会话");

function makeThreadState(messages: unknown[] = []) {
  return {
    messages,
    isLoading: false,
    error: null,
    values: {},
    stop: rs.fn(),
  };
}

function renderPanel(kb: KnowledgeBase | null = KB) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <KnowledgeChatPanel kb={kb} />
    </I18nContext.Provider>,
  );
}

beforeEach(() => {
  capturedMessageListProps = null;
  mockUseThreadStream.mockImplementation(() => ({
    thread: makeThreadState(),
    sendMessage: mockSendMessage,
  }));
  mockUseInfiniteThreads.mockReturnValue({
    data: { pages: [[KB_THREAD, OTHER_KB_THREAD, PLAIN_THREAD]] },
  });
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

function latestStreamOptions() {
  const calls = mockUseThreadStream.mock.calls;
  return calls.at(-1)?.[0] as {
    threadId?: string;
    context: Record<string, unknown>;
    onStart?: (threadId: string) => void;
  };
}

describe("KnowledgeChatPanel", () => {
  it("shows guidance and disables the input when no kb is selected (spec §4.5)", () => {
    renderPanel(null);
    expect(screen.getByText("未选择知识库")).toBeTruthy();
    expect(screen.getByText("请先在左侧选择要检索的知识库")).toBeTruthy();
    const textarea = screen.getByPlaceholderText("向当前知识库提问…");
    expect(textarea).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "发送" })).toHaveProperty("disabled", true);
  });

  it("binds the current kb through stream context (agent_name + kb_id)", () => {
    renderPanel();
    const options = latestStreamOptions();
    expect(options.context.agent_name).toBe("rag");
    expect(options.context.kb_id).toBe("kb-1");
    expect(options.context.deep_research).toBe(false);
    expect(options.threadId).toBeUndefined();
  });

  it("propagates the deep-retrieval toggle as context.deep_research (spec §4.7)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("switch"));
    expect(latestStreamOptions().context.deep_research).toBe(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(latestStreamOptions().context.deep_research).toBe(false);
  });

  it("sends the draft through sendMessage with the current thread id", () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText("向当前知识库提问…");
    fireEvent.change(textarea, { target: { value: "这个产品支持哪些格式？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [threadId, message] = mockSendMessage.mock.calls[0] as [string, { text: string; files: unknown[] }];
    expect(typeof threadId).toBe("string");
    expect(threadId.length).toBeGreaterThan(0);
    expect(message.text).toBe("这个产品支持哪些格式？");
    expect(message.files).toEqual([]);
    expect(textarea).toHaveProperty("value", "");
  });

  it("lists only current-kb threads in the history popover, grouped by date", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "历史会话" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByText("如何上传文档")).toBeTruthy();
    expect(screen.queryByText("别的库会话")).toBeNull();
    expect(screen.queryByText("普通会话")).toBeNull();
    expect(screen.getByText("2026-08-09")).toBeTruthy();
  });

  it("loads the selected conversation from the history popover", () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "历史会话" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByText("如何上传文档"));
    expect(latestStreamOptions().threadId).toBe("thread-kb1-a");
  });

  it("resets to a fresh thread via the new-chat button after picking history", () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "历史会话" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByText("如何上传文档"));
    expect(latestStreamOptions().threadId).toBe("thread-kb1-a");
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(latestStreamOptions().threadId).toBeUndefined();
  });

  it("adopts the backend-created thread id via onStart (metadata.kb_id thread)", () => {
    renderPanel();
    act(() => {
      latestStreamOptions().onStart?.("created-thread-1");
    });
    expect(latestStreamOptions().threadId).toBe("created-thread-1");
  });

  it("expands the active conversation to the full rag chat page", () => {
    renderPanel();
    expect(
      screen.getByRole("link", { name: "在完整页面中打开" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("button", { name: "历史会话" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByText("如何上传文档"));
    const link = screen.getByRole("link", { name: "在完整页面中打开" });
    expect(link.getAttribute("href")).toBe("/workspace/agents/rag/chats/thread-kb1-a");
  });

  it("renders citation cards below assistant answers via the message footer (spec §4.6)", () => {
    const toolMessage = {
      id: "tool-1",
      type: "tool",
      name: "hybrid_search",
      content: JSON.stringify({
        results: [
          {
            chunk_id: "doc-1#0000",
            doc_name: "产品手册.pdf",
            page: 3,
            heading_path: [],
            text: "知识库系统将非结构化文档转化为可检索的知识资产。",
            score: 0.9,
          },
        ],
      }),
    };
    const aiMessage = { id: "ai-1", type: "ai", content: "支持 PDF 与 Markdown [1]" };
    mockUseThreadStream.mockImplementation(() => ({
      thread: makeThreadState([
        { id: "human-1", type: "human", content: "支持哪些格式？" },
        toolMessage,
        aiMessage,
      ]),
      sendMessage: mockSendMessage,
    }));
    renderPanel();
    expect(capturedMessageListProps).not.toBeNull();
    const renderFooter = capturedMessageListProps!.renderMessageFooter as (
      message: unknown,
    ) => React.ReactNode;
    cleanup();
    render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        {renderFooter(aiMessage)}
      </I18nContext.Provider>,
    );
    expect(screen.getByText("参考来源")).toBeTruthy();
    expect(screen.getByText("产品手册.pdf")).toBeTruthy();
  });
});
