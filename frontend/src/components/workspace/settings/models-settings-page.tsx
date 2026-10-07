"use client";

import { GripVerticalIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY, ModelsConfigRequestError } from "@/core/models/api";
import {
  flattenUiOrder,
  groupByProvider,
  groupsToFlat,
  isMovableRow,
  reorderMovable,
} from "@/core/models/grouping";
import { useModelsConfig, useSaveModelsConfig } from "@/core/models/hooks";
import type {
  ManagedModel,
  ManagedModelInput,
  ProviderId,
} from "@/core/models/types";
import { cn } from "@/lib/utils";

import { FunctionalModelsView } from "./functional-models-view";
import { InfoTip } from "./info-tip";
import { ModelsAddDialog } from "./models-add-dialog";
import { ModelsEditDialog } from "./models-edit-dialog";
import { SettingsSection } from "./settings-section";

/**
 * Project an admin-view model back into a PUT input, preserving its key.
 *
 * Must carry every capability field: the collection is written wholesale, so a
 * field dropped here is erased from the stored model on the next save of any
 * other model.
 *
 */
function toManagedInput(model: ManagedModel): ManagedModelInput {
  return {
    provider: (model.provider ?? "openai-compatible") as ProviderId,
    name: model.name,
    model: model.model,
    display_name: model.display_name ?? undefined,
    description: model.description ?? undefined,
    api_key: MASKED_API_KEY,
    endpoint: model.endpoint ?? undefined,
    supports_thinking: model.supports_thinking,
    supports_vision: model.supports_vision,
    supports_reasoning_effort: model.supports_reasoning_effort,
    supported_context_windows: model.supported_context_windows ?? undefined,
    supported_reasoning_efforts: model.supported_reasoning_efforts ?? undefined,
    reasoning_effort: model.reasoning_effort ?? undefined,
    context_window: model.context_window ?? undefined,
    when_thinking_enabled: model.when_thinking_enabled ?? undefined,
    when_thinking_disabled: model.when_thinking_disabled ?? undefined,
    default_headers: model.default_headers ?? undefined,
    // Carried verbatim: the edit dialog is what normalizes an explicit `false` away,
    // and only for the row it rewrites (spec 2026-09-21 D6).
    max_tokens: model.max_tokens ?? undefined,
    use_responses_api: model.use_responses_api ?? undefined,
  };
}

export function ModelsSettingsPage() {
  const { t } = useI18n();
  const M = t.settings.models;
  const F = t.settings.functionalModels;
  const { config, isLoading, error } = useModelsConfig();
  const save = useSaveModelsConfig();
  const adminRequired =
    error instanceof ModelsConfigRequestError && error.isAdminRequired;

  const [view, setView] = useState<"chat" | "functional">("chat");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedModel | null>(null);
  // Local mirror of the server list (spec 2026-10-08 models-list-grouping): drag
  // reordering is optimistic and writes back once on drop; the hidden-name list
  // lives here too and rides on every save (the PUT write is wholesale).
  const [rows, setRows] = useState<ManagedModel[]>([]);
  const [hiddenInChat, setHiddenInChat] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    if (!config) return;
    setRows(config.models);
    // D1: the default row's toggle is locked on, so its name never enters the list
    // from here — a polluted file self-heals on the next save.
    const defaultName = config.models[0]?.name;
    setHiddenInChat(
      config.models
        .filter((model) => model.hidden_in_chat && model.name !== defaultName)
        .map((model) => model.name),
    );
  }, [config]);

  function groupLabel(provider: string): string {
    switch (provider) {
      case "openai-compatible":
        return M.providerOpenaiCompatible;
      case "anthropic":
        return M.providerAnthropic;
      case "deepseek":
        return M.providerDeepseek;
      default:
        return M.customProvider;
    }
  }

  /** The PUT array: UI entries in grouped flatten order (spec §2③, review ★2). */
  function uiInputs(orderedRows: ManagedModel[]): ManagedModelInput[] {
    return flattenUiOrder(groupByProvider(orderedRows)).map(toManagedInput);
  }

  function persist(
    next: ManagedModelInput[],
    hidden: string[],
    successMessage: string,
    options?: { onError?: () => void },
  ) {
    save.mutate(
      { models: next, hidden_in_chat: hidden },
      {
        onSuccess: () => toast.success(successMessage),
        onError: () => options?.onError?.(),
      },
    );
  }

  function handleAdd(entries: ManagedModelInput[]) {
    persist([...uiInputs(rows), ...entries], hiddenInChat, M.saved);
  }

  function handleEdit(input: ManagedModelInput) {
    persist(
      uiInputs(rows).map((model) =>
        model.name === input.name ? input : model,
      ),
      hiddenInChat,
      M.saved,
    );
  }

  function handleDelete(name: string) {
    const nextRows = rows.filter((model) => model.name !== name);
    // No dangling names: the deleted model leaves the hidden list too (review 9).
    const nextHidden = hiddenInChat.filter((hiddenName) => hiddenName !== name);
    setRows(nextRows);
    setHiddenInChat(nextHidden);
    persist(uiInputs(nextRows), nextHidden, M.deleted);
  }

  function handleToggle(name: string, shown: boolean) {
    const previous = hiddenInChat;
    const next = shown
      ? previous.filter((hiddenName) => hiddenName !== name)
      : [...previous, name];
    setHiddenInChat(next);
    persist(uiInputs(rows), next, M.saved, {
      onError: () => setHiddenInChat(previous),
    });
  }

  function handleDragMove(sourceName: string, targetName: string) {
    const groups = groupByProvider(rows);
    const next = reorderMovable(groups, sourceName, targetName);
    // Clamp (review ★2): crossing a pinned row or a group boundary returns the
    // same groups — no move, no half-step displacement to snap back later.
    if (next === groups) return;
    setRows(groupsToFlat(next));
    dragMovedRef.current = true;
  }

  function handleDragEnd() {
    setDragId(null);
    if (!dragMovedRef.current) return;
    dragMovedRef.current = false;
    persist(uiInputs(rows), hiddenInChat, M.saved, {
      onError: () => setRows(config?.models ?? []),
    });
  }

  return (
    <SettingsSection
      // Both views' prose lives in the one ⓘ on the section title (2026-09-16): each said what
      // it configured in a line of its own, and the functional view's line then sat under the
      // view switch with nothing on it but an icon. The two sentences describe one section.
      title={
        <span className="flex items-center gap-1.5">
          {M.title}
          <InfoTip
            text={`${M.description} ${F.description}`}
            content={
              <>
                <p>{M.description}</p>
                <p className="mt-1">{F.description}</p>
              </>
            }
          />
        </span>
      }
    >
      {/* One row: the view switch on the left, its own action on the right — a second
          line holding only a button left the header half empty. The row carries a floor of
          its own and the action stays `sm`, so the functional view's taller header no longer
          shifts this line when the view changes (2026-09-23). */}
      <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label={M.viewSwitchLabel}
          value={view}
          onValueChange={(next) => {
            if (next) setView(next as "chat" | "functional");
          }}
        >
          <ToggleGroupItem value="chat" aria-label={M.viewChatModels}>
            {M.viewChatModels}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="functional"
            aria-label={M.viewFunctionalModels}
          >
            {M.viewFunctionalModels}
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Same visibility as before the move: the action belongs to a usable list, not to
            the loading / admin-required / error states. */}
        {view === "chat" && !adminRequired && !error && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon className="size-4" />
            {M.add}
          </Button>
        )}
      </div>

      {view === "functional" ? (
        <FunctionalModelsView />
      ) : isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : adminRequired ? (
        <div className="text-muted-foreground text-sm">{M.adminRequired}</div>
      ) : error ? (
        <div>Error: {error.message}</div>
      ) : (
        <div className="flex w-full flex-col gap-4">
          {rows.length === 0 ? (
            <div className="text-muted-foreground text-sm">{M.empty}</div>
          ) : (
            groupByProvider(rows).map((group) => (
              // One merged container per provider (spec §2①): rows read as a list,
              // not a stack of loose cards. `bg-card` keeps the shared surface story
              // with the functional view's panels (2026-09-16).
              <div
                className="bg-card overflow-hidden rounded-lg border"
                data-testid="model-group"
                key={group.provider}
              >
                <div className="text-muted-foreground px-3 pt-2.5 pb-1 text-xs font-medium">
                  {groupLabel(group.provider)}
                </div>
                {group.rows.map((row, index) => {
                  const movable = isMovableRow(row);
                  const isDefault = row.name === rows[0]?.name;
                  const hidden = hiddenInChat.includes(row.name);
                  return (
                    <div
                      className="flex gap-3 px-3"
                      data-model-name={row.name}
                      data-testid="model-row"
                      draggable={movable || undefined}
                      key={row.name}
                      onDragEnd={handleDragEnd}
                      onDragOver={(event) => {
                        if (!dragId || dragId === row.name) return;
                        event.preventDefault();
                        if (event.dataTransfer)
                          event.dataTransfer.dropEffect = "move";
                        handleDragMove(dragId, row.name);
                      }}
                      onDragStart={(event) => {
                        if (!movable) return;
                        setDragId(row.name);
                        if (event.dataTransfer) {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", row.name);
                        }
                      }}
                      onDrop={(event) => {
                        // The move already happened on crossing; drop just lands.
                        event.preventDefault();
                        handleDragEnd();
                      }}
                    >
                      <div className="flex w-6 shrink-0 items-center justify-center">
                        {movable && (
                          <GripVerticalIcon
                            className="text-muted-foreground size-4"
                            data-testid="drag-handle"
                          />
                        )}
                      </div>
                      {/* The divider hangs on the name segment only (spec §2①): it
                          starts at the name text and stops before the control zone —
                          a subtle, deliberately incomplete separator. */}
                      <div
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 py-2.5",
                          index > 0 && "border-t border-border/50",
                        )}
                      >
                        <span className="truncate text-sm">
                          {row.display_name ?? row.name}
                        </span>
                        {isDefault && (
                          <Badge
                            className="h-5 px-1.5 text-[11px]"
                            variant="secondary"
                          >
                            {M.defaultBadge}
                          </Badge>
                        )}
                      </div>
                      <div className="flex w-52 shrink-0 items-center justify-end gap-2 py-2.5">
                        {!row.editable && (
                          // The read-only capsule explains the missing buttons
                          // (state riding on the row it describes).
                          <Badge variant="secondary">{M.sourceConfigFile}</Badge>
                        )}
                        {isDefault ? (
                          // A disabled button swallows hover and focus, so the
                          // reason lives on a wrapping trigger (D1).
                          <Tooltip content={M.defaultToggleLockReason}>
                            <span className="inline-flex">
                              <Switch
                                aria-label={M.showInChat}
                                checked
                                disabled
                              />
                            </span>
                          </Tooltip>
                        ) : (
                          <Switch
                            aria-label={M.showInChat}
                            checked={!hidden}
                            onCheckedChange={(checked) =>
                              handleToggle(row.name, checked)
                            }
                          />
                        )}
                        {row.editable && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={M.edit}
                              onClick={() => setEditing(row)}
                            >
                              <PencilIcon className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={M.delete}
                              onClick={() => handleDelete(row.name)}
                            >
                              <TrashIcon className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          <ModelsAddDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            existingNames={rows.map((m) => m.name)}
            onAdd={handleAdd}
            isPending={save.isPending}
          />
          <ModelsEditDialog
            open={editing !== null}
            onOpenChange={(next) => {
              if (!next) setEditing(null);
            }}
            model={editing}
            onSave={handleEdit}
            isPending={save.isPending}
          />
        </div>
      )}
    </SettingsSection>
  );
}
