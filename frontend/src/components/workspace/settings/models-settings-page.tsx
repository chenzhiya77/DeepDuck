"use client";

import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY, ModelsConfigRequestError } from "@/core/models/api";
import { useModelsConfig, useSaveModelsConfig } from "@/core/models/hooks";
import type {
  ManagedModel,
  ManagedModelInput,
  ProviderId,
} from "@/core/models/types";

import { FunctionalModelsView } from "./functional-models-view";
import { ModelsAddDialog } from "./models-add-dialog";
import { ModelsEditDialog } from "./models-edit-dialog";
import { SettingsSection } from "./settings-section";

/**
 * Project an admin-view model back into a PUT input, preserving its key.
 *
 * Must carry every capability field: the collection is written wholesale, so a
 * field dropped here is erased from the stored model on the next save of any
 * other model.
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
    supported_reasoning_efforts:
      model.supported_reasoning_efforts ?? undefined,
    reasoning_effort: model.reasoning_effort ?? undefined,
    context_window: model.context_window ?? undefined,
  };
}

export function ModelsSettingsPage() {
  const { t } = useI18n();
  const M = t.settings.models;
  const { config, isLoading, error } = useModelsConfig();
  const save = useSaveModelsConfig();
  const adminRequired =
    error instanceof ModelsConfigRequestError && error.isAdminRequired;

  const [view, setView] = useState<"chat" | "functional">("chat");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedModel | null>(null);

  function providerLabel(provider: ManagedModel["provider"]): string {
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

  function persist(next: ManagedModelInput[], successMessage: string) {
    save.mutate(next, { onSuccess: () => toast.success(successMessage) });
  }

  const models = config?.models ?? [];
  const uiModels = models.filter((m) => m.editable);

  function handleAdd(entries: ManagedModelInput[]) {
    persist([...uiModels.map(toManagedInput), ...entries], M.saved);
  }

  function handleEdit(input: ManagedModelInput) {
    persist(
      uiModels.map((m) => (m.name === input.name ? input : toManagedInput(m))),
      M.saved,
    );
  }

  function handleDelete(name: string) {
    persist(
      uiModels.filter((m) => m.name !== name).map(toManagedInput),
      M.deleted,
    );
  }

  return (
    <SettingsSection title={M.title} description={M.description}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={M.viewSwitchLabel}
        className="mb-4"
        value={view}
        onValueChange={(next) => {
          if (next) setView(next as "chat" | "functional");
        }}
      >
        <ToggleGroupItem value="chat" aria-label={M.viewChatModels}>
          {M.viewChatModels}
        </ToggleGroupItem>
        <ToggleGroupItem value="functional" aria-label={M.viewFunctionalModels}>
          {M.viewFunctionalModels}
        </ToggleGroupItem>
      </ToggleGroup>

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
          <div className="flex justify-end">
            <Button onClick={() => setAddOpen(true)}>
              <PlusIcon className="size-4" />
              {M.add}
            </Button>
          </div>

          {models.length === 0 ? (
            <div className="text-muted-foreground text-sm">{M.empty}</div>
          ) : (
            models.map((model) => (
              <Item className="w-full" variant="outline" key={model.name}>
                <ItemContent>
                  <ItemTitle>{model.display_name ?? model.name}</ItemTitle>
                  <ItemDescription>
                    {providerLabel(model.provider)} · {model.model}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge
                    variant={model.source === "ui" ? "default" : "secondary"}
                  >
                    {model.source === "ui" ? M.sourceUi : M.sourceConfigFile}
                  </Badge>
                  {model.editable && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={M.edit}
                        onClick={() => setEditing(model)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={M.delete}
                        onClick={() => handleDelete(model.name)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </>
                  )}
                </ItemActions>
              </Item>
            ))
          )}

          <ModelsAddDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            existingNames={models.map((m) => m.name)}
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
