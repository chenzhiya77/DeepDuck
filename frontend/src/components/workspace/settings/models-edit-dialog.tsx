"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY } from "@/core/models/api";
import {
  canSendEffortLevels,
  capabilityInputFromValue,
  capabilityValueForProvider,
  capabilityValueFromModel,
  emptyCapabilityValue,
  type ModelCapabilityValue,
} from "@/core/models/capability";
import type { ManagedModel, ManagedModelInput, ProviderId } from "@/core/models/types";
import { AUTOFILL_OFF_INPUT_PROPS, SECRET_INPUT_AUTOFILL_PROPS } from "@/lib/input-autofill";

import { InfoTip } from "./info-tip";
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
  const displayNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!model) return;
    setDisplayName(model.display_name ?? "");
    setApiKey("");
    setEndpoint(model.endpoint ?? "");
    setMaxTokens("");
    setCapability(capabilityValueFromModel(model));
  }, [model]);

  if (!model) return null;

  // The provider is read-only here (identity is frozen), so this is a property of the row,
  // not of a control: an anthropic row simply has no effort axis to edit or to submit.
  const canSendEffort = canSendEffortLevels(model.provider);

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
      // Hiding the rows does not clear what a stored row already carries: saving this dialog
      // unchanged is how an admin repairs a row written before the guard existed.
      ...capabilityInputFromValue(
        capabilityValueForProvider(capability, model.provider),
      ),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-4 overflow-hidden"
        // Land the caret in the first field instead of on the title's ⓘ (2026-09-16): the
        // focus scope focuses the dialog's first tabbable, the ⓘ is it, and Radix opens a
        // tooltip whose trigger is focused — so the identity warning popped up by itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          displayNameRef.current?.focus();
        }}
      >
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
              <DialogTitle className="flex items-center gap-1.5">
                {M.editTitle}
                <InfoTip text={M.identityHint} />
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{M.displayName}</span>
                <Input
                  ref={displayNameRef}
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

              {/* Its own label, not the wizard's step-2 title — reusing that one leaked a
                  "2." into a dialog that has no step 1. */}
              <p className="text-sm font-medium">{M.capabilities}</p>
              <ModelCapabilityEditor
                value={capability}
                onChange={setCapability}
                canSendEffortLevels={canSendEffort}
              />

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
