"use client";

import { PlusIcon, TrashIcon } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY } from "@/core/models/api";
import { headersToRecord, type HeaderRow } from "@/core/models/batch";
import {
  capabilityInputFromValue,
  capabilityValueFromModel,
  emptyCapabilityValue,
  type ModelCapabilityValue,
} from "@/core/models/capability";
import {
  apiTypeToUseResponsesApi,
  thinkingRecipeFor,
  thinkingShapeFromEntry,
  type ThinkingRecipeFields,
  type ThinkingShape,
} from "@/core/models/thinking-shape";
import type {
  ManagedModel,
  ManagedModelInput,
  ProviderId,
} from "@/core/models/types";
import {
  AUTOFILL_OFF_INPUT_PROPS,
  SECRET_INPUT_AUTOFILL_PROPS,
} from "@/lib/input-autofill";

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
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [apiType, setApiType] = useState<"chat" | "responses">("chat");
  const [maxTokens, setMaxTokens] = useState("");
  const [capability, setCapability] =
    useState<ModelCapabilityValue>(emptyCapabilityValue);
  const [thinkingShape, setThinkingShape] = useState<ThinkingShape>("none");
  const [preservedRecipe, setPreservedRecipe] = useState<
    ThinkingRecipeFields | undefined
  >(undefined);
  const displayNameRef = useRef<HTMLInputElement>(null);

  function updateHeader(index: number, patch: Partial<HeaderRow>) {
    setHeaders((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  useEffect(() => {
    if (!model) return;
    setDisplayName(model.display_name ?? "");
    setApiKey("");
    setEndpoint(model.endpoint ?? "");
    // Stored values come back so a save rewrites them unchanged: the collection is
    // written wholesale and a field this dialog cannot show is erased on the next save
    // of any row (spec 2026-09-21 D6).
    setHeaders(
      Object.entries(model.default_headers ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
    );
    setApiType(model.use_responses_api === true ? "responses" : "chat");
    setMaxTokens(model.max_tokens != null ? String(model.max_tokens) : "");
    setCapability(capabilityValueFromModel(model));
    const reading = thinkingShapeFromEntry(model);
    setThinkingShape(reading.shape);
    // A hand-written recipe matches no literal: the row shows "not set", so saving has
    // to carry the original dicts back rather than write over them (spec 2026-09-21 D6).
    setPreservedRecipe(
      reading.preserve
        ? {
            when_thinking_enabled: model.when_thinking_enabled ?? undefined,
            when_thinking_disabled: model.when_thinking_disabled ?? undefined,
          }
        : undefined,
    );
  }, [model]);

  if (!model) return null;

  const provider = (model.provider ?? "openai-compatible") as ProviderId;

  function handleSubmit() {
    if (!model) return;
    const parsedMaxTokens = maxTokens.trim() ? Number(maxTokens) : undefined;
    const input: ManagedModelInput = {
      provider,
      name: model.name,
      model: model.model,
      display_name: displayName.trim() || undefined,
      api_key: apiKey || MASKED_API_KEY,
      endpoint: endpoint.trim() || undefined,
      max_tokens:
        parsedMaxTokens && parsedMaxTokens > 0 ? parsedMaxTokens : undefined,
      ...capabilityInputFromValue(capability),
      ...thinkingRecipeFor(provider, thinkingShape, preservedRecipe),
    };
    // Set only when there is something to set: an `undefined` value still makes the key
    // exist, and "never set" is spelled by absence — not by `{}` or by `false`
    // (spec 2026-09-21 D6).
    const headerRecord = headersToRecord(headers);
    if (headerRecord) input.default_headers = headerRecord;
    const responsesApi = apiTypeToUseResponsesApi(apiType);
    if (responsesApi) input.use_responses_api = responsesApi;
    onSave(input);
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

              {/* Same gate the add wizard uses: the field only means something for the
                  one provider whose class can route through /v1/responses. */}
              {provider === "openai-compatible" && (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{M.apiType}</span>
                  <Select
                    value={apiType}
                    onValueChange={(value) =>
                      setApiType(value as "chat" | "responses")
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={M.apiType}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">{M.apiTypeChat}</SelectItem>
                      <SelectItem value="responses">
                        {M.apiTypeResponses}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

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

              {/* Request headers (repeatable) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {M.defaultHeaders}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setHeaders((prev) => [...prev, { name: "", value: "" }])
                    }
                  >
                    <PlusIcon className="size-4" />
                    {M.addHeader}
                  </Button>
                </div>
                {headers.map((row, index) => (
                  <div className="flex items-center gap-2" key={index}>
                    <Input
                      className="min-w-0 flex-1"
                      {...AUTOFILL_OFF_INPUT_PROPS}
                      value={row.name}
                      placeholder={M.headerNamePlaceholder}
                      onChange={(e) =>
                        updateHeader(index, { name: e.target.value })
                      }
                    />
                    <Input
                      className="min-w-0 flex-1"
                      {...AUTOFILL_OFF_INPUT_PROPS}
                      value={row.value}
                      placeholder={M.headerValuePlaceholder}
                      onChange={(e) =>
                        updateHeader(index, { value: e.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={M.removeHeader}
                      onClick={() =>
                        setHeaders((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Its own label, not the wizard's step-2 title — reusing that one leaked a
                  "2." into a dialog that has no step 1. */}
              <p className="text-sm font-medium">{M.capabilities}</p>
              <ModelCapabilityEditor
                value={capability}
                onChange={setCapability}
                provider={provider}
                thinkingShape={thinkingShape}
                onThinkingShapeChange={setThinkingShape}
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
