"use client";

import type { Message } from "@langchain/langgraph-sdk";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  HistoryIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MessageList } from "@/components/workspace/messages";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { sourcesForAssistantMessage } from "@/core/knowledge/citations";
import { threadsForKb } from "@/core/knowledge/kb-threads";
import type { KnowledgeBase } from "@/core/knowledge/types";
import {
  buildHumanInputResponseText,
  type HumanInputRequest,
  type HumanInputResponse,
} from "@/core/messages/human-input";
import { useDeleteThread, useInfiniteThreads, useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { cn } from "@/lib/utils";

import { KbAssistantContent } from "./kb-assistant-content";
import { KbCitationSources } from "./kb-citation-sources";

/**
 * Right-column chat panel bound to the selected knowledge base (spec
 * §4.5/§4.6/§4.7/§5.2). Conversations stay isolated per kb: the stream context
 * carries ``kb_id`` (persisted into ``metadata.kb_id`` on thread creation),
 * the history popover lists only this kb's threads, and the global recent-chat
 * list filters kb threads out (ima-style isolation).
 */
export function KnowledgeChatPanel({
  kb,
  onOpenWikiEntry,
}: {
  kb: KnowledgeBase | null;
  /** Wiki citation cards open the entry drawer (overlay) via this page-held callback. */
  onOpenWikiEntry?: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const tc = t.knowledge.chat;
  const kbId = kb?.id ?? null;

  const [threadId, setThreadId] = useState(() => uuid());
  const [isNewThread, setIsNewThread] = useState(true);
  const [deepResearch, setDeepResearch] = useState(false);
  const [draft, setDraft] = useState("");

  // Switching knowledge bases always starts a fresh conversation: threads are
  // bound to exactly one kb via metadata.kb_id and must never bleed across.
  useEffect(() => {
    setThreadId(uuid());
    setIsNewThread(true);
    setDraft("");
  }, [kbId]);

  const context = useMemo(
    () => ({
      model_name: undefined,
      mode: undefined,
      reasoning_effort: undefined,
      agent_name: "rag",
      ...(kbId ? { kb_id: kbId } : {}),
      deep_research: deepResearch,
    }),
    [kbId, deepResearch],
  );

  const {
    thread,
    sendMessage,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
  } = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setIsNewThread(false);
    },
  });

  const threadsQuery = useInfiniteThreads();
  const kbThreads = useMemo(() => {
    if (!kbId) {
      return [];
    }
    const all = threadsQuery.data?.pages.flat() ?? [];
    return threadsForKb(all, kbId);
  }, [threadsQuery.data, kbId]);
  const threadsByDay = useMemo(() => {
    const groups = new Map<string, typeof kbThreads>();
    for (const kbThread of kbThreads) {
      const day = kbThread.updated_at.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), kbThread]);
    }
    return [...groups.entries()];
  }, [kbThreads]);

  const handleNewChat = useCallback(() => {
    setThreadId(uuid());
    setIsNewThread(true);
    setDraft("");
  }, []);
  const handleSelectThread = useCallback((nextThreadId: string) => {
    setThreadId(nextThreadId);
    setIsNewThread(false);
  }, []);

  // Same operation logic as the general recent-chat list: useDeleteThread
  // cascades sidecar cleanup + remote delete + local data + query-cache
  // eviction (the history popover re-renders without the row automatically).
  // Deleting the OPEN conversation resets the panel to a fresh chat, mirroring
  // the general list's isCurrentThread handling.
  const { mutate: deleteThread } = useDeleteThread();
  const handleDeleteThread = useCallback(
    (deletedThreadId: string) => {
      const isCurrent = !isNewThread && deletedThreadId === threadId;
      deleteThread({
        threadId: deletedThreadId,
        onRemoteDeleted: isCurrent ? handleNewChat : undefined,
      });
    },
    [deleteThread, handleNewChat, isNewThread, threadId],
  );

  const canSend = Boolean(kbId) && draft.trim().length > 0 && !thread.isLoading;
  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!kbId || !text || thread.isLoading) {
      return;
    }
    void sendMessage(threadId, { text, files: [] });
    setDraft("");
  }, [draft, kbId, sendMessage, thread.isLoading, threadId]);

  const renderMessageFooter = useCallback(
    (message: Message) => {
      if (message.type !== "ai") {
        return null;
      }
      return (
        <KbCitationSources
          messageId={message.id ?? ""}
          onOpenWikiEntry={onOpenWikiEntry}
          sources={sourcesForAssistantMessage(thread.messages, message.id)}
        />
      );
    },
    [thread.messages, onOpenWikiEntry],
  );

  // P2 citation UX (phase-2 batch-1): the answer's [n] markers become
  // superscript CitationMarks once streaming ends (deferred — a half-typed
  // `[` mid-stream never flickers). Human messages stay untouched; surfaces
  // without this prop render plain markdown as before.
  const renderMessageContent = useCallback(
    (message: Message, content: string, isLoading: boolean) => {
      if (message.type !== "ai") {
        return undefined;
      }
      return (
        <KbAssistantContent
          content={content}
          isLoading={isLoading}
          messageId={message.id ?? ""}
          sources={sourcesForAssistantMessage(thread.messages, message.id)}
        />
      );
    },
    [thread.messages],
  );

  // Mirrors the general chat page: answering an ask_clarification interrupt
  // sends a hidden message carrying the structured human_input_response.
  const handleSubmitHumanInput = useCallback(
    async (request: HumanInputRequest, response: HumanInputResponse) => {
      let sent = false;
      await sendMessage(
        threadId,
        {
          text: buildHumanInputResponseText(request, response),
          files: [],
        },
        { agent_name: "rag" },
        {
          additionalKwargs: {
            hide_from_ui: true,
            human_input_response: response,
          },
          onSent: () => {
            sent = true;
          },
        },
      );
      return sent;
    },
    [sendMessage, threadId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="knowledge-chat-panel">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {kb?.name ?? ""}
        </div>
        <Button
          aria-label={tc.newChat}
          size="icon-sm"
          variant="ghost"
          onClick={handleNewChat}
        >
          <PlusIcon className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={tc.history} size="icon-sm" variant="ghost">
              <HistoryIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {threadsByDay.length === 0 ? (
              <DropdownMenuLabel>{tc.noHistory}</DropdownMenuLabel>
            ) : (
              threadsByDay.map(([day, dayThreads]) => (
                <div key={day}>
                  <DropdownMenuLabel>{day}</DropdownMenuLabel>
                  {dayThreads.map((kbThread) => (
                    <DropdownMenuItem
                      key={kbThread.thread_id}
                      className="group/history-item"
                      onClick={() => handleSelectThread(kbThread.thread_id)}
                    >
                      <span className="truncate">
                        {kbThread.values?.title ?? kbThread.thread_id}
                      </span>
                      {/* stopPropagation keeps the row from being selected and
                          the popover open, so several stale conversations can
                          be cleaned up in one go. */}
                      <button
                        aria-label={tc.deleteChat}
                        className="text-muted-foreground hover:text-foreground ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity focus-visible:opacity-100 group-hover/history-item:opacity-100"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          handleDeleteThread(kbThread.thread_id);
                        }}
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Link
          aria-disabled={isNewThread}
          aria-label={tc.expandToFullPage}
          className={cn(
            "hover:bg-accent hover:text-accent-foreground inline-flex size-8 items-center justify-center rounded-md",
            isNewThread && "pointer-events-none opacity-50",
          )}
          href={isNewThread ? "#" : `/workspace/agents/rag/chats/${threadId}`}
        >
          <ArrowUpRightIcon className="size-4" />
        </Link>
      </header>

      <div className="min-h-0 flex-1">
        {kb ? (
          <MessageList
            className="size-full"
            threadId={threadId}
            thread={thread}
            hasMoreHistory={hasMoreHistory}
            loadMoreHistory={loadMoreHistory}
            isHistoryLoading={isHistoryLoading}
            renderMessageContent={renderMessageContent}
            renderMessageFooter={renderMessageFooter}
            onSubmitHumanInput={handleSubmitHumanInput}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="text-sm font-medium">{t.knowledge.selectKbTitle}</div>
            <div className="text-xs">{t.knowledge.selectKbHint}</div>
          </div>
        )}
      </div>

      {/* Composer styled after the home-page InputBox: one rounded container
          holds the textarea, the deep-retrieval toggle, and the send button. */}
      <div className="shrink-0 border-t p-3">
        <div className="focus-within:border-ring focus-within:ring-ring/50 rounded-xl border shadow-xs transition-colors focus-within:ring-[3px]">
          <Textarea
            className="max-h-32 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            disabled={!kb || thread.isLoading}
            placeholder={tc.inputPlaceholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <Tooltip content={tc.deepResearchHint}>
              <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
                <Switch
                  checked={deepResearch}
                  disabled={!kb}
                  onCheckedChange={setDeepResearch}
                />
                <span>{tc.deepResearch}</span>
              </label>
            </Tooltip>
            <Tooltip content={tc.send}>
              {/* The span keeps the tooltip reachable while the button is disabled */}
              <span className="inline-flex">
                <Button
                  aria-label={tc.send}
                  className="rounded-full"
                  disabled={!canSend}
                  size="icon-sm"
                  onClick={handleSubmit}
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
