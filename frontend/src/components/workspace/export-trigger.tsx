"use client";

import { Download, FileJson, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeBase } from "@/core/knowledge/types";
import { exportThread, type ThreadExportFormat } from "@/core/threads/export";
import { importThreadToKnowledgeBase } from "@/core/threads/import-to-knowledge-base";
import type { AgentThread } from "@/core/threads/types";

import { KnowledgeBaseImportSubMenu } from "./knowledge-base-import-submenu";
import { useThread } from "./messages/context";
import { Tooltip } from "./tooltip";

export function ExportTrigger({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { thread } = useThread();

  const messages = thread.messages;

  const handleExport = useCallback(
    (format: ThreadExportFormat) => {
      if (messages.length === 0) {
        toast.error(t.conversation.noMessages);
        return;
      }
      try {
        const agentThread = {
          thread_id: threadId,
          updated_at: new Date().toISOString(),
          values: thread.values,
        } as AgentThread;

        exportThread(agentThread, messages, format);
        toast.success(t.common.exportSuccess);
      } catch {
        toast.error(t.common.exportFailed);
      }
    },
    [messages, thread.values, threadId, t],
  );

  const handleImportToKnowledgeBase = useCallback(
    async (kb: KnowledgeBase) => {
      if (messages.length === 0) {
        toast.error(t.conversation.noMessages);
        return;
      }
      try {
        const agentThread = {
          thread_id: threadId,
          updated_at: new Date().toISOString(),
          values: thread.values,
        } as AgentThread;

        await importThreadToKnowledgeBase(agentThread, messages, kb.id);
        toast.success(t.common.importToKbSuccess(kb.name), {
          action: {
            label: t.common.viewKnowledgeBase,
            onClick: () => router.push("/workspace/knowledge"),
          },
        });
      } catch {
        toast.error(t.common.importToKbFailed);
      }
    },
    [messages, thread.values, threadId, t, router],
  );

  if (messages.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <Tooltip content={t.common.export}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t.common.export}
            className="text-muted-foreground hover:text-foreground"
            variant="ghost"
          >
            <Download />
            <span className="hidden sm:inline">{t.common.export}</span>
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleExport("markdown")}>
          <FileText className="text-muted-foreground" />
          <span>{t.common.exportAsMarkdown}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleExport("json")}>
          <FileJson className="text-muted-foreground" />
          <span>{t.common.exportAsJSON}</span>
        </DropdownMenuItem>
        <KnowledgeBaseImportSubMenu
          withSeparator
          onSelect={(kb) => void handleImportToKnowledgeBase(kb)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
