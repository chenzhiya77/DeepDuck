"use client";

import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

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
import { validateModelsConfig } from "@/core/models/api";
import { expandBatchToEntries } from "@/core/models/batch";
import {
  capabilityValueFromSuggestion,
  capabilityValueToShared,
  emptyCapabilityValue,
  type ModelCapabilityValue,
} from "@/core/models/capability";
import { suggestCapabilities } from "@/core/models/capability-registry";
import type { ManagedModelInput, ProviderId } from "@/core/models/types";
import { AUTOFILL_OFF_INPUT_PROPS, SECRET_INPUT_AUTOFILL_PROPS } from "@/lib/input-autofill";

import { ModelCapabilityEditor } from "./model-capability-editor";

interface ModelsAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All existing model names (config.yaml + UI) used for -2/-3 dedupe. */
  existingNames: string[];
  /** Called with the expanded new entries; the caller merges + persists. */
  onAdd: (entries: ManagedModelInput[]) => void;
  isPending: boolean;
}

/**
 * Two-step "add models" dialog (spec 2026-09-10 §5.3.1–§5.3.2): step 1 collects
 * one shared credential block plus N Model IDs and validates them against the
 * provider; only a passing probe unlocks step 2, the capability editor. The
 * backend contract is unchanged — the client expands step 2 into N flat entries.
 */
export function ModelsAddDialog({
  open,
  onOpenChange,
  existingNames,
  onAdd,
  isPending,
}: ModelsAddDialogProps) {
  const { t } = useI18n();
  const M = t.settings.models;

  const [step, setStep] = useState<"identity" | "capabilities">("identity");
  const [provider, setProvider] = useState<ProviderId>("openai-compatible");
  const [apiType, setApiType] = useState<"chat" | "responses">("chat");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([""]);
  const [capability, setCapability] = useState<ModelCapabilityValue>(
    emptyCapabilityValue,
  );
  const [suggested, setSuggested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  function updateModelId(index: number, value: string) {
    setModelIds((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function reset() {
    setStep("identity");
    setProvider("openai-compatible");
    setApiType("chat");
    setEndpoint("");
    setApiKey("");
    setShowKey(false);
    setModelIds([""]);
    setCapability(emptyCapabilityValue());
    setSuggested(false);
    setError(null);
    setWarning(null);
    setValidating(false);
  }

  function enteredModelIds(): string[] {
    return modelIds.map((id) => id.trim()).filter(Boolean);
  }

  /** Step 1 → step 2: validate every Model ID, then seed the capability editor. */
  async function handleNext() {
    const ids = enteredModelIds();
    if (ids.length === 0) {
      setError(M.validationNoModelId);
      return;
    }
    if (!endpoint.trim()) {
      setError(M.validationEndpointRequired);
      return;
    }
    if (!apiKey) {
      setError(M.validationApiKeyRequired);
      return;
    }

    setError(null);
    setValidating(true);
    // Non-blocking advice rides along: the probe tolerates a method path, the runtime does not.
    let advice: string | null = null;
    try {
      for (const modelId of ids) {
        const result = await validateModelsConfig({
          provider,
          endpoint: endpoint.trim(),
          api_key: apiKey,
          model: modelId,
        });
        if (!result.ok || !result.model_present) {
          setError(`${M.validateFailed} ${result.detail}`);
          return;
        }
        advice = advice ?? result.warning ?? null;
      }
    } catch (validationError) {
      setError(`${M.validateFailed} ${(validationError as Error).message}`);
      return;
    } finally {
      setValidating(false);
    }

    const seed = capabilityValueFromSuggestion(
      suggestCapabilities(ids[0] ?? ""),
    );
    setCapability(seed);
    setSuggested(
      seed.supportedWindows.length > 0 ||
        seed.supportedEfforts.length > 0 ||
        seed.supportsThinking ||
        seed.supportsVision,
    );
    setWarning(advice);
    setStep("capabilities");
  }

  function handleSubmit() {
    const entries = expandBatchToEntries(
      {
        provider,
        endpoint: endpoint.trim() || undefined,
        apiKey: apiKey || undefined,
        apiType,
        ...capabilityValueToShared(capability),
      },
      modelIds,
      existingNames,
    );
    onAdd(entries);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
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
              <DialogTitle>{M.addTitle}</DialogTitle>
            </DialogHeader>

            {step === "identity" ? (
              <div className="space-y-4 py-1">
                {/* Provider */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{M.provider}</span>
                  <Select
                    value={provider}
                    onValueChange={(value) => setProvider(value as ProviderId)}
                  >
                    <SelectTrigger className="w-full" aria-label={M.provider}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai-compatible">
                        {M.providerOpenaiCompatible}
                      </SelectItem>
                      <SelectItem value="anthropic">{M.providerAnthropic}</SelectItem>
                      <SelectItem value="deepseek">{M.providerDeepseek}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* API type — only meaningful for openai-compatible (spec §5.3.1) */}
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
                        <SelectItem value="responses">{M.apiTypeResponses}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Endpoint — required, the probe is built from it (spec §5.3.2) */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{M.endpoint}</span>
                  <Input
                    type="url"
                    {...AUTOFILL_OFF_INPUT_PROPS}
                    value={endpoint}
                    aria-label={M.endpoint}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </div>

                {/* API key */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{M.apiKey}</span>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      {...SECRET_INPUT_AUTOFILL_PROPS}
                      value={apiKey}
                      aria-label={M.apiKey}
                      className="pr-10"
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={M.apiKeyToggle}
                      onClick={() => setShowKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
                    >
                      {showKey ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Model IDs (repeatable) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{M.modelIds}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setModelIds((prev) => [...prev, ""])}
                    >
                      <PlusIcon className="size-4" />
                      {M.addModelId}
                    </Button>
                  </div>
                  {modelIds.map((id, index) => (
                    <div className="flex items-center gap-2" key={index}>
                      <Input
                        value={id}
                        placeholder={M.modelIdPlaceholder}
                        onChange={(e) => updateModelId(index, e.target.value)}
                      />
                      {modelIds.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={M.removeModelId}
                          onClick={() =>
                            setModelIds((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          <TrashIcon className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {error && (
                  <p className="text-destructive text-sm" role="alert">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 py-1">
                {warning && (
                  <p
                    className="text-muted-foreground text-sm"
                    role="status"
                  >
                    {warning}
                  </p>
                )}
                <ModelCapabilityEditor
                  value={capability}
                  onChange={setCapability}
                  suggested={suggested}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0">
          {step === "identity" ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending || validating}
              >
                {t.common.cancel}
              </Button>
              <Button onClick={handleNext} disabled={isPending || validating}>
                {validating ? M.validating : M.next}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("identity")}
                disabled={isPending}
              >
                {M.back}
              </Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending ? t.common.loading : M.addSubmit}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
