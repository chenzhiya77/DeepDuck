"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { KnowledgeChatPanel } from "@/components/workspace/knowledge/chat-panel";
import { ChunkDrawer } from "@/components/workspace/knowledge/chunk-drawer";
import { DocumentPanel } from "@/components/workspace/knowledge/document-panel";
import { KbListPanel } from "@/components/workspace/knowledge/kb-list-panel";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocuments,
  useGenerateWiki,
  useKnowledgeBases,
  useRetryDocument,
  useUpdateKnowledgeBase,
  useUploadDocument,
} from "@/core/knowledge/hooks";
import type { KnowledgeDocument } from "@/core/knowledge/types";

function showMutationError(error: unknown, fallback: string) {
  toast.error(error instanceof Error && error.message ? error.message : fallback);
}

/**
 * Knowledge base workspace (spec §5.2): three columns — kb list, document
 * management for the selected kb, and a chat panel whose threads stay bound
 * to that kb via ``metadata.kb_id`` (ima-style isolation).
 */
export default function KnowledgePage() {
  const { t } = useI18n();
  const tk = t.knowledge;
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [drawerDoc, setDrawerDoc] = useState<KnowledgeDocument | null>(null);

  const kbsQuery = useKnowledgeBases();
  const kbs = useMemo(() => kbsQuery.data ?? [], [kbsQuery.data]);
  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null;

  // Default to the first kb; fall back to the remaining first after a delete.
  useEffect(() => {
    if (kbs.length === 0) {
      if (selectedKbId !== null) {
        setSelectedKbId(null);
      }
      return;
    }
    if (!selectedKb) {
      setSelectedKbId(kbs[0]!.id);
    }
  }, [kbs, selectedKb, selectedKbId]);

  const documentsQuery = useDocuments(selectedKbId);
  const documents = documentsQuery.data ?? [];

  const createKb = useCreateKnowledgeBase();
  const updateKb = useUpdateKnowledgeBase();
  const deleteKb = useDeleteKnowledgeBase();
  const uploadDocument = useUploadDocument(selectedKbId ?? "");
  const deleteDocument = useDeleteDocument(selectedKbId ?? "");
  const retryDocument = useRetryDocument(selectedKbId ?? "");
  const generateWiki = useGenerateWiki(selectedKbId ?? "");

  return (
    <div className="flex size-full min-h-0 overflow-x-auto" data-testid="knowledge-page">
      <aside className="w-56 shrink-0 border-r xl:w-64">
        <KbListPanel
          kbs={kbs}
          selectedKbId={selectedKbId}
          onSelect={setSelectedKbId}
          onCreate={async (name, description) => {
            try {
              const created = await createKb.mutateAsync({ name, description });
              setSelectedKbId(created.id);
            } catch (error) {
              showMutationError(error, tk.errors.createFailed);
            }
          }}
        />
      </aside>

      <section className="min-w-[20rem] flex-1 border-r">
        {selectedKb ? (
          <DocumentPanel
            kb={selectedKb}
            documents={documents}
            uploading={uploadDocument.isPending}
            onUpload={(files) => {
              void (async () => {
                for (const file of files) {
                  try {
                    await uploadDocument.mutateAsync(file);
                  } catch (error) {
                    showMutationError(error, tk.errors.uploadFailed);
                  }
                }
              })();
            }}
            onGenerateWiki={() => {
              generateWiki.mutate(undefined, {
                onSuccess: () => toast.success(tk.wikiEnqueued),
                onError: (error) => showMutationError(error, tk.errors.wikiFailed),
              });
            }}
            onRenameKb={async (name) => {
              try {
                await updateKb.mutateAsync({ kbId: selectedKb.id, patch: { name } });
              } catch (error) {
                showMutationError(error, tk.errors.renameFailed);
              }
            }}
            onDeleteKb={async () => {
              try {
                await deleteKb.mutateAsync(selectedKb.id);
              } catch (error) {
                showMutationError(error, tk.errors.deleteFailed);
              }
            }}
            onDeleteDocument={async (docId) => {
              try {
                await deleteDocument.mutateAsync(docId);
              } catch (error) {
                showMutationError(error, tk.errors.deleteDocumentFailed);
              }
            }}
            onRetryDocument={(docId) => {
              retryDocument.mutate(docId, {
                onError: (error) => showMutationError(error, tk.errors.retryFailed),
              });
            }}
            onOpenChunks={setDrawerDoc}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {tk.selectKbHint}
          </div>
        )}
      </section>

      <aside className="w-[22rem] shrink-0 xl:w-[26rem]">
        <KnowledgeChatPanel kb={selectedKb} />
      </aside>

      {drawerDoc && selectedKbId && (
        <ChunkDrawer
          kbId={selectedKbId}
          doc={drawerDoc}
          open={drawerDoc !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDrawerDoc(null);
            }
          }}
        />
      )}
    </div>
  );
}
