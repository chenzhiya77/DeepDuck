"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY } from "@/core/models/api";
import {
  capabilityInputFromValue,
  capabilityValueFromModel,
  emptyCapabilityValue,
  type ModelCapabilityValue,
} from "@/core/models/capability";
import type { ManagedModel, ManagedModelInput, ProviderId } from "@/core/models/types";
import { AUTOFILL_OFF_INPUT_PROPS, SECRET_INPUT_AUTOFILL_PROPS } from "@/lib/input-autofill";

import { ModelCapabilityEditor } from "./model-capability-editor";

interface ModelsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ManagedModel | null;
  onSave: (input: ManagedModelInput) => void;
  isPending: boolean;
}

/**
 * Single-model edit dialog (spec 2026-09-10 §5.7). Provider / model / name are
 * identity fields and are read-only after creation; an empty api_key means
 * "keep the stored key" (the masking sentinel is submitted). Capabilities are
 * edited with the same editor the add wizard uses.
 */
export function ModelsEditDialog({
  open,
  onOpenChange,
  model,
  onSave,
  isPending,
}: ModelsEditDialogProps) {
  const { t } = useI18n();
  const M = t.settings.models;

  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [capability, setCapability] = useState<ModelCapabilityValue>(
    emptyCapabilityValue,
  );

  useEffect(() => {
    if (!model) return;
    setDisplayName(model.display_name ?? "");
    setApiKey("");
    setEndpoint(model.endpoint ?? "");
    setMaxTokens("");
    setCapability(capabilityValueFromModel(model));
  }, [model]);

  if (!model) return null;

  function handleSubmit() {
    if (!model) return;
    const parsedMaxTokens = maxTokens.trim() ? Number(maxTokens) : undefined;
    onSave({
      provider: (model.provider ?? "openai-compatible") as ProviderId,
      name: model.name,
      model: model.model,
      display_name: displayName.trim() || undefined,
      api_key: apiKey || MASKED_API_KEY,
      endpoint: endpoint.trim() || undefined,
      max_tokens:
        parsedMaxTokens && parsedMaxTokens > 0 ? parsedMaxTokens : undefined,
      ...capabilityInputFromValue(capability),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden">
        {/* Scrollable body with a pinned footer (wiki-edit-dialog precedent). The
            max-h MUST sit on the ScrollArea root: DialogContent's own height is an
            auto height capped by max-h (indefinite), so a flex-1 child inherits no
            bound and the viewport never becomes a scroll container. */}
        <ScrollArea
          className="-mr-6 max-h-[calc(90vh-7rem)] min-h-0 min-w-0 flex-1"
          scrollHideDelay={2000}
          type="scroll"
        >
          <div className="flex min-w-0 flex-col gap-4 pr-6">
            <DialogHeader>
              <DialogTitle>{M.editTitle}</DialogTitle>
              <DialogDescription>{M.editDescription}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <p className="text-muted-foreground text-xs">{M.identityHint}</p>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">{M.displayName}</span>
                <Input
                  value={displayName}
                  aria-label={M.displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">{M.apiKey}</span>
                <Input
                  type="password"
                  {...SECRET_INPUT_AUTOFILL_PROPS}
                  value={apiKey}
                  aria-label={M.apiKey}
                  placeholder={MASKED_API_KEY}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">{M.endpoint}</span>
                <Input
                  type="url"
                  {...AUTOFILL_OFF_INPUT_PROPS}
                  value={endpoint}
                  aria-label={M.endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>

              <p className="text-muted-foreground text-xs">{M.stepCapabilities}</p>
              <ModelCapabilityEditor value={capability} onChange={setCapability} />

              <div className="space-y-1.5">
                <span className="text-sm font-medium">{M.maxTokens}</span>
                <Input
                  type="number"
                  min={1}
                  value={maxTokens}
                  aria-label={M.maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? t.common.loading : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
