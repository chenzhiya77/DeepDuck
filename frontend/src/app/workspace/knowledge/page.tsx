"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { KnowledgeChatPanel } from "@/components/workspace/knowledge/chat-panel";
import { ChunkDrawer } from "@/components/workspace/knowledge/chunk-drawer";
import { DocumentPanel } from "@/components/workspace/knowledge/document-panel";
import { KbListPanel } from "@/components/workspace/knowledge/kb-list-panel";
import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { KnowledgePanelsShell } from "@/components/workspace/knowledge/panels-shell";
import { RecallTestPanel } from "@/components/workspace/knowledge/recall-test-panel";
import { WikiEntryDrawer } from "@/components/workspace/knowledge/wiki-entry-drawer";
import { WikiPanel } from "@/components/workspace/knowledge/wiki-panel";
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
  useWikiEntries,
} from "@/core/knowledge/hooks";
import type { KnowledgeDocument, WikiEntrySummary } from "@/core/knowledge/types";

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
  // Middle-column tab + entry drawer state (phase-2 batch-1). The drawer is
  // an overlay — opening it never switches the tab; only the drawer's
  // explicit 在百科 tab 中查看 action navigates (revealWikiEntry).
  const [activeTab, setActiveTab] = useState<KnowledgeMiddleTab>("documents");
  const [drawerEntryId, setDrawerEntryId] = useState<string | null>(null);

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
  // Lazy: the wiki list only fetches once its tab is first activated
  // (keep-alive panes stay mounted, so the gate is what keeps it lazy).
  const wikiEntriesQuery = useWikiEntries(selectedKbId, activeTab === "wiki");
  const wikiEntries = wikiEntriesQuery.data ?? [];

  const openWikiEntry = (entry: WikiEntrySummary) => setDrawerEntryId(entry.id);
  const revealWikiEntry = (entryId: string) => {
    setActiveTab("wiki");
    setDrawerEntryId(null);
    void entryId; // the list is unpaginated — the entry is visible after the switch
  };

  const createKb = useCreateKnowledgeBase();
  const updateKb = useUpdateKnowledgeBase();
  const deleteKb = useDeleteKnowledgeBase();
  const uploadDocument = useUploadDocument(selectedKbId ?? "");
  const deleteDocument = useDeleteDocument(selectedKbId ?? "");
  const retryDocument = useRetryDocument(selectedKbId ?? "");
  const generateWiki = useGenerateWiki(selectedKbId ?? "");

  return (
    <div className="size-full min-h-0" data-testid="knowledge-page">
      <KnowledgePanelsShell
        left={({ collapseLeft }) => (
          <KbListPanel
            kbs={kbs}
            selectedKbId={selectedKbId}
            onSelect={setSelectedKbId}
            onCollapse={collapseLeft}
            onCreate={async (name, description) => {
              try {
                const created = await createKb.mutateAsync({ name, description });
                setSelectedKbId(created.id);
              } catch (error) {
                showMutationError(error, tk.errors.createFailed);
              }
            }}
          />
        )}
        middle={
          selectedKb ? (
            <MiddleTabs
              kb={selectedKb}
              activeTab={activeTab}
              onTabChange={setActiveTab}
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
              documents={
                <DocumentPanel
                  kb={selectedKb}
                  documents={documents}
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
              }
              wiki={
                <WikiPanel
                  entries={wikiEntries}
                  loading={wikiEntriesQuery.isLoading}
                  onOpenEntry={openWikiEntry}
                />
              }
              recall={
                <RecallTestPanel
                  kbId={selectedKb.id}
                  onOpenWikiEntry={(entryId) => setDrawerEntryId(entryId)}
                />
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {tk.selectKbHint}
            </div>
          )
        }
        right={<KnowledgeChatPanel kb={selectedKb} />}
      />

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

      {drawerEntryId && selectedKbId && (
        <WikiEntryDrawer
          entryId={drawerEntryId}
          kbId={selectedKbId}
          open={drawerEntryId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDrawerEntryId(null);
            }
          }}
          onRevealInTab={revealWikiEntry}
        />
      )}
    </div>
  );
}
