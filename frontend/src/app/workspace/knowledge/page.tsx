"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { KnowledgeChatPanel } from "@/components/workspace/knowledge/chat-panel";
import { ChunkDrawer } from "@/components/workspace/knowledge/chunk-drawer";
import { DocumentPanel } from "@/components/workspace/knowledge/document-panel";
import {
  DuplicateUploadDialog,
  type DuplicateAction,
} from "@/components/workspace/knowledge/duplicate-upload-dialog";
import { KbListPanel } from "@/components/workspace/knowledge/kb-list-panel";
import { ManualCardDrawer } from "@/components/workspace/knowledge/manual-card-drawer";
import { ManualCardPanel } from "@/components/workspace/knowledge/manual-card-panel";
import { MiddleTabs, type KnowledgeMiddleTab } from "@/components/workspace/knowledge/middle-tabs";
import { KnowledgePanelsShell } from "@/components/workspace/knowledge/panels-shell";
import { RecallTestPanel } from "@/components/workspace/knowledge/recall-test-panel";
import { WikiEditDialog } from "@/components/workspace/knowledge/wiki-edit-dialog";
import { WikiEntryDrawer } from "@/components/workspace/knowledge/wiki-entry-drawer";
import { WikiPanel } from "@/components/workspace/knowledge/wiki-panel";
import { useI18n } from "@/core/i18n/hooks";
import {
  computeSha256,
  findDuplicateByName,
  nextCopyName,
  verdictForDuplicate,
} from "@/core/knowledge/duplicate-check";
import { executeDuplicateAction } from "@/core/knowledge/duplicate-upload-flow";
import {
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDeleteWikiEntry,
  useDocuments,
  useGenerateWiki,
  useKnowledgeBases,
  useRetryDocument,
  useSupportedFormats,
  useUpdateKnowledgeBase,
  useUpdateWikiEntry,
  useUploadDocument,
  useWikiEntries,
  useWikiEntry,
} from "@/core/knowledge/hooks";
import { FALLBACK_SUPPORTED_SUFFIXES } from "@/core/knowledge/supported-formats";
import type { KnowledgeDocument, WikiEntrySummary } from "@/core/knowledge/types";
import { isWikiUpdating } from "@/core/knowledge/wiki-status";

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
  // Phase-3 P6 混排修复：检索测试 wiki 路命中人工卡片时开卡片抽屉（卡片
  // id 走 wiki 详情接口必然 404）。
  const [drawerCardId, setDrawerCardId] = useState<string | null>(null);
  // Wiki 更新状态可见 (2026-08-14): a manual trigger keeps the entries query
  // enabled (hence polling) even off the wiki tab — the trigger menu lives in
  // the library header, visible from every tab. Cleared on the observed
  // generating→idle transition or on kb switch (code-review finding).
  const [wikiRunActive, setWikiRunActive] = useState(false);
  // Phase-3 Batch-1 P1: wiki entry editing state
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  // Lazy: the wiki list fetches once its tab is first activated or a manual
  // update run is triggered (keep-alive panes stay mounted — the gate is
  // what keeps it lazy).
  const wikiEntriesQuery = useWikiEntries(selectedKbId, activeTab === "wiki" || wikiRunActive);
  const wikiEntries = wikiEntriesQuery.data?.entries ?? [];

  // Task 6 upload allowlist: endpoint is the source of truth, with a local
  // mirror as fallback until the query resolves (spec §6).
  const supportedFormatsQuery = useSupportedFormats();
  const supportedSuffixes = supportedFormatsQuery.data?.suffixes ?? FALLBACK_SUPPORTED_SUFFIXES;

  const openWikiEntry = (entry: WikiEntrySummary) => setDrawerEntryId(entry.id);
  const revealWikiEntry = (entryId: string) => {
    setActiveTab("wiki");
    setDrawerEntryId(null);
    void entryId; // the list is unpaginated — the entry is visible after the switch
  };
  // Phase-3 Batch-1 P1: open edit dialog for a wiki entry
  const handleEditEntry = (entry: WikiEntrySummary) => {
    setEditingEntryId(entry.id);
    setEditDialogOpen(true);
  };

  const createKb = useCreateKnowledgeBase();
  const updateKb = useUpdateKnowledgeBase();
  const deleteKb = useDeleteKnowledgeBase();
  const uploadDocument = useUploadDocument(selectedKbId ?? "");
  const deleteDocument = useDeleteDocument(selectedKbId ?? "");
  const retryDocument = useRetryDocument(selectedKbId ?? "");
  const generateWiki = useGenerateWiki(selectedKbId ?? "");
  const deleteWikiEntry = useDeleteWikiEntry(selectedKbId ?? "");
  const updateWikiEntry = useUpdateWikiEntry(selectedKbId ?? "");

  // Wiki 更新状态可见 (2026-08-14): live 更新中 feedback + completion toast.
  // `isPending` covers the click→first-poll gap; the toast observes the
  // server-reported generating→idle transition, so a no-op run or a missed
  // poll never produces a phantom 已更新.
  const wikiUpdating = isWikiUpdating(wikiEntriesQuery.data, generateWiki.isPending);
  const wikiManualRunRef = useRef(false);
  const prevWikiGenerationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    wikiManualRunRef.current = false;
    prevWikiGenerationRef.current = undefined;
    setWikiRunActive(false);
  }, [selectedKbId]);
  useEffect(() => {
    const generation = wikiEntriesQuery.data?.generation;
    const prev = prevWikiGenerationRef.current;
    prevWikiGenerationRef.current = generation;
    if (prev === "generating" && generation === "idle" && wikiManualRunRef.current) {
      wikiManualRunRef.current = false;
      setWikiRunActive(false);
      // P1 失败可见性 (2026-08-14): a crashed run also drains the flag —
      // toast the truth instead of the success copy.
      if (wikiEntriesQuery.data?.last_run === "failed") {
        toast.error(tk.wikiUpdateFailed);
      } else {
        toast.success(tk.wikiUpdated);
      }
    }
  }, [wikiEntriesQuery.data, tk.wikiUpdated, tk.wikiUpdateFailed]);
  // Fetch full entry detail when editing
  const editingEntryQuery = useWikiEntry(selectedKbId, editingEntryId);
  const editingEntry = editingEntryQuery.data ?? null;

  // ── Task 11 duplicate-upload interception ─────────────────────────────
  // Both upload entries (MiddleTabs library menu + DocumentPanel drag/pick)
  // funnel into `uploadFilesWithCheck`: hash the file, pre-check against the
  // current document list, and queue a confirm dialog on a same-name hit.
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    fileName: string;
    kind: "identical" | "conflict";
    doc: KnowledgeDocument;
    copyName: string;
    resolve: (action: DuplicateAction) => void;
  } | null>(null);
  // Fresh document list for the pre-check — props in flight during the loop
  // would otherwise go stale after a replace mutation.
  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const doUpload = async (file: File) => {
    try {
      await uploadDocument.mutateAsync(file);
    } catch (error) {
      showMutationError(error, tk.errors.uploadFailed);
    }
  };

  const uploadFilesWithCheck = (files: File[]) => {
    void (async () => {
      for (const file of files) {
        let hash: string;
        try {
          hash = await computeSha256(file);
        } catch {
          // WebCrypto unavailable (non-secure context) — degrade to a plain
          // upload rather than blocking the pipeline.
          await doUpload(file);
          continue;
        }
        const currentDocs = documentsRef.current;
        const verdict = verdictForDuplicate(findDuplicateByName(file.name, currentDocs), hash);
        if (verdict.kind === "clean") {
          await doUpload(file);
          continue;
        }
        const copyName = nextCopyName(file.name, new Set(currentDocs.map((d) => d.name)));
        const action = await new Promise<DuplicateAction>((resolve) => {
          setPendingDuplicate({
            fileName: file.name,
            kind: verdict.kind,
            doc: verdict.doc,
            copyName,
            resolve: (chosen) => {
              setPendingDuplicate(null);
              resolve(chosen);
            },
          });
        });
        try {
          const outcome = await executeDuplicateAction(
            action,
            { file, doc: verdict.doc, copyName },
            {
              deleteDocument: (docId) => deleteDocument.mutateAsync(docId),
              uploadFile: doUpload,
            },
          );
          if (outcome === "skipped") {
            toast.info(tk.duplicateUpload.skippedDuplicate(file.name));
          } else if (outcome === "copied") {
            toast.success(tk.duplicateUpload.uploadedAsCopy(copyName));
          } else if (outcome === "replaced") {
            toast.success(tk.duplicateUpload.replacedDocument(file.name));
          }
        } catch (error) {
          showMutationError(error, tk.errors.uploadFailed);
        }
      }
    })();
  };

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
              supportedSuffixes={supportedSuffixes}
              onUpload={uploadFilesWithCheck}
              onGenerateWiki={(mode) => {
                generateWiki.mutate(mode, {
                  onSuccess: (ack) => {
                    // P1 触发幂等 (2026-08-14): a run is already draining the
                    // dirty set (manual or worker-auto) — inform, but don't
                    // arm the completion toast for a run we didn't start.
                    if (ack.status === "already_running") {
                      toast.info(tk.wikiAlreadyRunning);
                      return;
                    }
                    // Start toast stays (the trigger lives in the library
                    // menu, visible from every tab); the completion toast
                    // fires on the generating→idle transition above. The run
                    // flag keeps the entries query polling from any tab.
                    wikiManualRunRef.current = true;
                    setWikiRunActive(true);
                    toast.success(tk.wikiEnqueued);
                  },
                  onError: (error) => showMutationError(error, tk.errors.wikiFailed),
                });
              }}
              wikiUpdating={wikiUpdating}
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
                  supportedSuffixes={supportedSuffixes}
                  onUpload={uploadFilesWithCheck}
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
                <>
                  <WikiPanel
                    entries={wikiEntries}
                    loading={wikiEntriesQuery.isLoading}
                    updating={wikiUpdating}
                    onOpenEntry={openWikiEntry}
                    onEditEntry={handleEditEntry}
                    onDeleteEntry={(entry) => {
                      deleteWikiEntry.mutate(entry.id, {
                        onError: (error) => showMutationError(error, tk.errors.deleteWikiEntryFailed),
                      });
                    }}
                  />
                  {/* Phase-3 Batch-1 P6: manual cards sit below the AI wiki
                      entries (spec §8 双通道) — collapsible, default collapsed. */}
                  <ManualCardPanel kbId={selectedKb.id} />
                </>
              }
              recall={
                <RecallTestPanel
                  kbId={selectedKb.id}
                  onOpenWikiEntry={(entryId) => setDrawerEntryId(entryId)}
                  onOpenManualCard={(cardId) => setDrawerCardId(cardId)}
                />
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {tk.selectKbHint}
            </div>
          )
        }
        right={
          <KnowledgeChatPanel
            kb={selectedKb}
            onOpenWikiEntry={(entryId) => setDrawerEntryId(entryId)}
          />
        }
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

      {drawerCardId && selectedKbId && (
        <ManualCardDrawer
          cardId={drawerCardId}
          kbId={selectedKbId}
          open={drawerCardId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDrawerCardId(null);
            }
          }}
        />
      )}

      {/* Task 11 duplicate-upload confirm (queued per conflicting file) */}
      <DuplicateUploadDialog
        pending={pendingDuplicate}
        onResolve={(action) => pendingDuplicate?.resolve(action)}
      />

      {/* Phase-3 Batch-1 P1: Wiki entry edit dialog */}
      {editingEntry && (
        <WikiEditDialog
          entry={editingEntry}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSave={async (entryId, content, supplementContent) => {
            try {
              await updateWikiEntry.mutateAsync({
                entryId,
                body: { content, supplement_content: supplementContent },
              });
              toast.success("Wiki 条目已更新");
              setEditingEntryId(null);
            } catch (error) {
              showMutationError(error, "更新 Wiki 条目失败");
              throw error; // Re-throw to keep dialog open on error
            }
          }}
        />
      )}
    </div>
  );
}
